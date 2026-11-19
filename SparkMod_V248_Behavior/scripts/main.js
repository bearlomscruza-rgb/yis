import './mace_limits_v208.js';
import './spark_rules_v207.js';
import './bundle_cleanup_v205.js';
import './titan_player_damage_v201.js';
import './structure_discovery_v188.js';
import './structure_discovery_v188.js';
import './castle_spawn_v200.js';
import './world_structures_v183.js';
import './sites_v244.js';
import './structures_v232.js';
import './bolt_titan.js';
import './titan_boss.js';
import './structure_protection.js';
// Old Warden challenge replaced with Bolt Titan summoning.
import './colosseum_v182.js';
import './temple.js';
import './pvp_arena.js';
import { world, system, ItemStack, EquipmentSlot, EnchantmentTypes, WeatherType } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { issueGodArmor, rechargeSparkChest, sparkChestStatus, sparkChestAwakened } from './spark_systems_v229.js';
import * as F from './titan_fx_v217.js';
import { initSparkBow, forgeSparkBow, awakenSparkBow, rechargeSparkBow, sparkBowShrineLabel } from './spark_bow_v238.js';
import { siteOf, getSite } from './sites_v244.js';

// SparkMod V25: gameplay polish pass. Requires custom item/entity/block JSON.
// V59: Spark Dimension removed. Weapons, armor, token and gacha remain.
const I = Object.freeze({
  tear:'sparkmod:spark_token', mace:'minecraft:mace', sword:'sparkmod:spark_sword', awakenedSword:'sparkmod:awakened_spark_sword',
  sparkite:'sparkmod:sparkite',
  helmet:'sparkmod:god_helmet', helmetV3:'sparkmod:god_helmet_v3', chest:'sparkmod:god_chestplate', chestV3:'sparkmod:god_chestplate_v3', legs:'sparkmod:god_leggings', legsV3:'sparkmod:god_leggings_v3', boots:'sparkmod:god_boots', bootsV3:'sparkmod:god_boots_v3',
  altar:'sparkmod:spark_altar'
});
const TICKS = 20;
const DAY = 24*60*60*1000;

const recentlyProcessedDeaths = new Set();
const safe = (fn, fallback=undefined) => {try {return fn();} catch(e) {console.warn('[SparkMod]',String(e)); return fallback;}};
const tell = (p,msg) => { try { p.sendMessage(msg); } catch(e) {} }; // Team request feedback
const bag = p => safe(()=>p.getComponent('minecraft:inventory')?.container);
const equipment = (p,slot) => safe(()=>p.getComponent('minecraft:equippable')?.getEquipment(slot));
const held = p => equipment(p,EquipmentSlot.Mainhand)?.typeId;
const SPARK_MACE_LORE = '§8SparkMod: genuine vanilla mace';
const isSparkMace = p => {
 const item = equipment(p,EquipmentSlot.Mainhand);
 return item?.typeId === 'minecraft:mace' &&
   (item.nameTag === '§6Spark Mace' || item.nameTag === '§5⚡ Awakened Spark Mace' || (item.getLore?.() ?? []).includes(SPARK_MACE_LORE));
};
const isSparkSword = id => id===I.sword || id===I.awakenedSword;
const prop = (holder,key,def=0) => safe(()=>holder.getDynamicProperty('sparkmod:'+key),def) ?? def;
const setProp = (holder,key,val) => safe(()=>holder.setDynamicProperty('sparkmod:'+key,val));
const hasFullSet = p => [I.helmet,I.helmetV3].includes(equipment(p,EquipmentSlot.Head)?.typeId) && [I.chest,I.chestV3].includes(equipment(p,EquipmentSlot.Chest)?.typeId) && [I.legs,I.legsV3].includes(equipment(p,EquipmentSlot.Legs)?.typeId) && [I.boots,I.bootsV3].includes(equipment(p,EquipmentSlot.Feet)?.typeId);
const valid = e => !!e && safe(()=>typeof e.isValid==='function'?e.isValid():e.isValid===true,false);
function count(p,id){const b=bag(p); if(!b)return 0; let n=0;for(let k=0;k<b.size;k++){const s=b.getItem(k);if(s?.typeId===id)n+=s.amount;}return n;}
function take(p,id,n){const b=bag(p);if(!b||count(p,id)<n)return false;for(let k=0;k<b.size&&n>0;k++){const s=b.getItem(k);if(s?.typeId!==id)continue;const d=Math.min(s.amount,n);if(d===s.amount)b.setItem(k,undefined);else{s.amount-=d;b.setItem(k,s);}n-=d;}return n===0;}
// Spark equipment is granted without automatic enchantments.
// Players may apply compatible enchanted books with an anvil.
// Sliding 10-minute earning cap on directly awarded Spark Tokens (per player).
// Keeps earned tokens in inventory untouched. PvP rewards use this helper;
// boss drops remain physical loot and aren't retroactively deleted.
const TOKEN_EARN_LIMIT=10,TOKEN_WINDOW_MS=10*60*1000;
function tokenAllowance(p,requested){
 const now=Date.now();
 let history=safe(()=>JSON.parse(prop(p,'tokenEarningsV207','[]')),[]);
 if(!Array.isArray(history))history=[];
 history=history.filter(e=>Array.isArray(e)&&Number.isFinite(e[0])&&Number.isFinite(e[1])&&now-e[0]<TOKEN_WINDOW_MS&&now-e[0]>=0);
 const already=history.reduce((n,e)=>n+e[1],0);
 const allowed=Math.max(0,Math.min(requested,TOKEN_EARN_LIMIT-already));
 if(allowed>0)history.push([now,allowed]);
 setProp(p,'tokenEarningsV207',JSON.stringify(history));
 if(allowed<requested){
  const next=history.length?Math.max(1,Math.ceil((TOKEN_WINDOW_MS-(now-history[0][0]))/1000)):600;
  tell(p,`§cSpark Token earning cap: ${TOKEN_EARN_LIMIT} per 10 minutes. ${next}s until your oldest earnings expire.`);
 }
 return allowed;
}
function give(p,id,n=1){
 if(id===I.tear)n=tokenAllowance(p,n);
 if(n<=0)return 0;
 return safe(()=>{
  const item=new ItemStack(id,n);
  if(id===I.mace){item.nameTag='§6Spark Mace';item.setLore([SPARK_MACE_LORE]);}
  const extra=bag(p)?.addItem(item);
  if(extra)p.dimension.spawnItem(extra,p.location);
  return n;
 },0);
}

// Convert legacy custom Spark Maces into native Bedrock maces so the actual
// vanilla smash engine (fall damage cancellation, smash scaling, knockback)
// is used rather than a scripted imitation.
system.runInterval(() => {
 for(const p of world.getAllPlayers()){
  const b=bag(p); if(!b) continue;
  for(let k=0;k<b.size;k++){
   const old=safe(()=>b.getItem(k));
   if(old?.typeId!=='sparkmod:spark_mace')continue;
   safe(()=>{
    const fresh=new ItemStack('minecraft:mace',1);
    fresh.nameTag='§6Spark Mace';fresh.setLore([SPARK_MACE_LORE]);
    b.setItem(k,fresh);
   });
  }
 }
},80);
function ready(p,key){const until=Number(prop(p,key,0));if(Date.now()>=until)return true;tell(p,`Cooldown: ${Math.ceil((until-Date.now())/1000)}s`);return false;}
function cooldown(p,key,ms){setProp(p,key,Date.now()+ms);}
function lightning(dim,pos){safe(()=>dim.spawnEntity('minecraft:lightning_bolt',pos));}
function nearestEnemy(origin,radius=25){return safe(()=>origin.dimension.getPlayers({location:origin.location,maxDistance:radius}).filter(p=>p.id!==prop(origin,'owner','')&&p.id!==origin.id&&!world.getAllPlayers().some(owner=>owner.id===prop(origin,'owner','')&&areTeammates(owner,p))).sort((a,b)=>distSq(a.location,origin.location)-distSq(b.location,origin.location))[0]);}
function distSq(a,b){return (a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2;}
function strikePlayer(target,damage){safe(()=>target.applyDamage(damage));}
// V29 Cloud Gacha: non-damaging storm-cloud animation above the player's head.
// The roll is consumed before the animation; the reward is delivered after it finishes.
const gachaActive = new Set();
const menuActive = new Set();
async function showForm(p,form){
 if(!valid(p)||menuActive.has(p.id))return;
 menuActive.add(p.id);
 try{return await form.show(p);}
 catch(error){console.warn('[SparkMod menu] '+String(error));return;}
 finally{menuActive.delete(p.id);}
}

function cloudGachaVisual(p, frame) {
  if (!valid(p)) return;
  const loc = p.location;
  const y = loc.y + 2.65;
  const dim = p.dimension;
  // Cloud puffs: smoke particles arranged into a floating, animated disk.
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + frame * 0.18;
    const radius = 0.9 + (i % 3) * 0.24;
    const pos = {x:loc.x + Math.cos(angle)*radius,
                 y:y + Math.sin(frame * 0.35 + i) * 0.12,
                 z:loc.z + Math.sin(angle)*radius};
    safe(()=>dim.spawnParticle('minecraft:basic_smoke_particle',pos));
  }
  // Gold spark flickers hanging under the cloud. Visual only, no damage.
  for (let i = 0; i < 4; i++) {
    const angle = (frame * 0.35 + i * 1.57);
    safe(()=>dim.spawnParticle('minecraft:basic_crit_particle',{
      x:loc.x + Math.cos(angle)*0.7,
      y:y - 0.35 - (i%3)*0.22,
      z:loc.z + Math.sin(angle)*0.7
    }));
  }
  if (frame === 6 || frame === 13) {
    safe(()=>p.playSound('ambient.weather.thunder',{volume:0.45,pitch:1.5}));
  }
}
// A Spark Token is consumed only when the roll begins.
// The display cycles through reward names, slows down, then reveals the reward.
const ROLL_NAMES = ['§7Ore','§dGod Apple','§6God Armor','§6Spark Mace','§6God Villager','§fCloud Loot'];
// A roll captures whether Spark Moon was active WHEN the token was spent.
// Objects are stored across logouts so the 30-minute moon boundary does not
// change a prize after the animation has already started. Legacy numeric rolls
// from earlier versions remain valid on reconnect.
function sparkPrize(value) {
  if (typeof value === 'number') return {r:value, moon:false};
  if (value && typeof value.r === 'number') return {r:value.r, moon:value.moon===true};
  return {r:Math.random(), moon:sparkMoonStatus().active};
}
function moonUniqueItem(r) {
  // 0.5% remains the God Villager slot. Six gear slots each occupy 15%.
  // During a moon: 0.5% villager, 90% unique gear slots, 9.5% other loot.
  if (r < .005 || r >= .905) return null;
  const index=Math.floor((r-.005)/.15);
  return UNIQUE_ROLLS[index] ?? null;
}
function moonRemainingFraction(r) {return Math.max(0,Math.min(1,(r-.905)/.095));}
// V237 roll table (same with or without a Spark Moon):
//  each God Armour piece 17.5%, Spark Mace 15%, Spark Sword 15%.
//  If the item you land on already exists in the world you get loot instead:
//  ore 50%, God Apple 30%, cloud loot 19%, God Villager 1%.
const ROLL_TABLE=[
  [.175,'unique','sparkmod:god_helmet'],[.35,'unique','sparkmod:god_chestplate'],
  [.525,'unique','sparkmod:god_leggings'],[.70,'unique','sparkmod:god_boots'],
  [.85,'unique','minecraft:mace'],[1.01,'unique','sparkmod:spark_sword']
];
const LOOT_TABLE=[[.50,'ore'],[.80,'apple'],[.99,'cloud'],[1.01,'villager']];
function lootKind(){const r=Math.random();for(const [max,k] of LOOT_TABLE)if(r<max)return k;return 'cloud';}
function rollKind(r){for(const [max,kind,id] of ROLL_TABLE)if(r<max)return {kind,id};return {kind:'cloud'};}
function rangeFor(id){let lo=0;for(const [max,kind,i] of ROLL_TABLE){if(i===id)return (lo+max)/2;lo=max;}return null;}
const prettyId=id=>id.replace('sparkmod:god_','God ').replace('sparkmod:','').replace('minecraft:mace','Spark Mace').replaceAll('_',' ');
function rewardName(value) {
  const {r}=sparkPrize(value);
  const k=rollKind(r);
  if(k.kind==='unique'){
    const claimed=String(prop(world,'uniqueSparkRolls','')).split('|').includes(k.id);
    return claimed?'§7'+prettyId(k.id).toUpperCase()+' §8(ALREADY CLAIMED) §7- LOOT':'§6'+prettyId(k.id).toUpperCase();
  }
  return {villager:'§6GOD VILLAGER',apple:'§dENCHANTED GOD APPLE',ore:'§eRANDOM ORE',cloud:'§fCLOUD LOOT'}[k.kind];
}
// Fruit-style roulette: quick reward cards, then progressively slower stops.
function playGachaCloud(p, rolls) {
  if(gachaActive.has(p.id)){tell(p,'§7Your cloud is already rolling!');return;}
  if(!take(p,I.tear,rolls)){tell(p,'§cNot enough Spark Tokens.');return;}
  gachaActive.add(p.id);
  const moonAtPurchase=sparkMoonStatus().active;
  const prizes=Array.from({length:rolls},()=>({r:Math.random(),moon:moonAtPurchase}));
  // V229 pity: every 15 Spark Tokens without unique Spark gear guarantees a unique piece.
  let pity=Number(prop(p,'sparkPity',0));
  for(const prize of prizes){
   const k=rollKind(prize.r);
   const claimed=String(prop(world,'uniqueSparkRolls','')).split('|');
   if(k.kind==='unique'&&!claimed.includes(k.id)){pity=0;continue;}
   pity++;
   const open=UNIQUE_ROLLS.find(id=>!claimed.includes(id));
   if(pity>=PITY_LIMIT&&open){prize.r=rangeFor(open);prize.moon=false;pity=0;tell(p,`§6⚡ PITY! ${PITY_LIMIT} Spark Tokens without Spark gear - this roll is guaranteed unique Spark equipment!`);}
  }
  setProp(p,'sparkPity',pity);
  setProp(p,'pendingSparkPrizes',JSON.stringify(prizes));
  const cards=['§7COMMON — Cloud Loot','§eUNCOMMON — Random Ore','§dRARE — God Apple',
    '§6LEGENDARY — Spark Equipment','§6LEGENDARY — Spark Equipment','§5MYTHIC — God Villager'];
  const delays=[2,2,2,2,2,2,2,3,3,3,3,4,4,5,5,6,7,8,10,12,15];
  let index=0;
  tell(p,'§e⚡ ROLL A SPARK §7— watch the rewards spin!');
  const step=()=>{
    if(!valid(p)){
      gachaActive.delete(p.id);
      // Saved before animation starts, while the player is still valid.
      return;
    }
    if(index>=delays.length){
      gachaActive.delete(p.id);
      safe(()=>p.playSound('random.levelup',{volume:1,pitch:1.1}));
      safe(()=>p.onScreenDisplay.setTitle('§6✦ YOU GOT! ✦',{
        subtitle:rewardName(prizes[0]),fadeInDuration:2,stayDuration:65,fadeOutDuration:12
      }));
      safe(()=>p.onScreenDisplay.setActionBar('§e⚡ YOUR SPARK: '+rewardName(prizes[0])));
      cloudGachaVisual(p,33);
      setProp(p,'pendingSparkPrizes','');
      for(const prize of prizes)roll(p,prize);
      return;
    }
    const card=index===delays.length-1?rewardName(prizes[0]):cards[(index*5+Math.floor(index/3))%cards.length];
    const shown=index===delays.length-1?'§6⚡ FINAL ROLL ⚡':'§e⚡ ROLLING... ⚡';
    safe(()=>p.onScreenDisplay.setTitle(shown,{
      subtitle:'§f[ '+card+' §f]',fadeInDuration:0,stayDuration:delays[index]+1,fadeOutDuration:0
    }));
    safe(()=>p.onScreenDisplay.setActionBar('§8◀ §6✦ §e'+card.replace(' — ',' §7• ')+' §6✦ §8▶'));
    safe(()=>p.playSound('random.orb',{volume:0.45,pitch:1.65-index*0.035}));
    cloudGachaVisual(p,index);
    system.runTimeout(step,delays[index++]);
  };
  system.runTimeout(step,2);
}
// Use the supported native ActionFormData. No global server_form.json override.
async function openSparkRollMenu(p, attempt=0){
  if(!valid(p))return;
  const form=new ActionFormData()
    .title('§e⚡ ROLL A SPARK')
    .body('§6☁ LIGHTNING CLOUD ☁\n§eSpend 1 Spark Token to roll for a reward!\n§7Pity: §f'+Number(prop(p,'sparkPity',0))+'/'+PITY_LIMIT+' §7(guaranteed unique Spark gear at '+PITY_LIMIT+')'+'\n§6Odds: §eeach God Armour piece 17.5%, Spark Mace 15%, Spark Sword 15%\n§7Already-claimed item = loot: ore 50%, God Apple 30%, cloud 19%, God Villager 1%')
    .button('§e⚡ ROLL A SPARK — 1 Token','textures/ui/spark_storm_cloud')
    .button('§c✕ EXIT');
  try{
    const response=await showForm(p,form);
    if(!response)return;
    if(response.canceled){
      // Another UI can temporarily block forms on Bedrock. Retry briefly.
      if(response.cancelationReason==='UserBusy'&&attempt<3)
        system.runTimeout(()=>openSparkRollMenu(p,attempt+1),12);
      return;
    }
    if(response.selection===0)playGachaCloud(p,1);
  }catch(error){
    console.warn('[SparkMod] Roll UI failed:',String(error));
    tell(p,'§cMenu could not open. Close chat or other menus and try the token again.');
  }
}
function showGacha(p){system.run(()=>openSparkRollMenu(p));}
// Unique legendary gacha rewards are claimed once per WORLD, not per player.
// Claims are stored on the world and survive restarts. Once the pool is empty,
// duplicate slots redirect to unclaimed armor, then a God Apple if armor is exhausted.
const UNIQUE_ROLLS=[I.sword,I.mace,I.helmet,I.chest,I.legs,I.boots];
const PITY_LIMIT=15;
function unclaimedUniqueCount(){const c=String(prop(world,'uniqueSparkRolls','')).split('|');return UNIQUE_ROLLS.filter(id=>!c.includes(id)).length;}
const GOD_ARMOR_IDS=[I.helmet,I.chest,I.legs,I.boots];
function claimUniqueRoll(){
  const claimed=String(prop(world,'uniqueSparkRolls','')).split('|').filter(Boolean);
  const remaining=UNIQUE_ROLLS.filter(id=>!claimed.includes(id));
  if(!remaining.length)return null;
  const chosen=remaining[Math.floor(Math.random()*remaining.length)];
  claimed.push(chosen);
  setProp(world,'uniqueSparkRolls',claimed.join('|'));
  return chosen;
}
function claimSpecificUniqueRoll(id) {
  if (!UNIQUE_ROLLS.includes(id)) return null;
  const claimed=String(prop(world,'uniqueSparkRolls','')).split('|').filter(Boolean);
  if (claimed.includes(id)) return null;
  claimed.push(id);
  setProp(world,'uniqueSparkRolls',claimed.join('|'));
  return id;
}
// If a Spark Moon roll lands on an item already claimed in this world, give
// one of the still-unclaimed armor pieces instead. Never create a duplicate.
const DUPLICATE_ARMOR_REWARDS=[I.helmet,I.chest,I.legs,I.boots];
function claimDuplicateArmorReward(){
  const claimed=new Set(String(prop(world,'uniqueSparkRolls','')).split('|').filter(Boolean));
  const candidates=DUPLICATE_ARMOR_REWARDS.filter(id=>!claimed.has(id));
  if(!candidates.length)return null;
  const selected=candidates[Math.floor(Math.random()*candidates.length)];
  // claimSpecificUniqueRoll rechecks the persistent world claim before awarding.
  return claimSpecificUniqueRoll(selected);
}
function giveUniqueRoll(p, requestedItem=null){
  const id=requestedItem===null?claimUniqueRoll():claimSpecificUniqueRoll(requestedItem);
  if(!id){
    // V237: the item already exists in this world - you get loot instead.
    tell(p,'§7That Spark item already exists in this world, so you get loot instead.');
    lootReward(p,lootKind());
    return;
    const upgrade=claimDuplicateArmorReward();
    if(upgrade){
      give(p,upgrade);
      if(GOD_ARMOR_IDS.includes(upgrade))issueGodArmor(p,upgrade);
      tell(p,'§6DUPLICATE ROLL UPGRADE! Guaranteed unclaimed Spark '+upgrade.replace('sparkmod:god_','').replaceAll('_',' ')+' §7(World exclusive)');
      return;
    }
    lootReward(p,lootKind());
    return;
  }
  give(p,id);
  if(GOD_ARMOR_IDS.includes(id))issueGodArmor(p,id);
  tell(p,'§6UNIQUE SPARK REWARD! '+id.replace('sparkmod:','').replace('minecraft:mace','Spark Mace').replaceAll('_',' ')+' §7(World exclusive)');
}
function normalLoot(p,kind){
  if(kind==='apple'){give(p,'minecraft:enchanted_golden_apple',1);tell(p,'§dRARE! Enchanted Golden Apple!');return;}
  if(kind==='ore'){
    const ores=['minecraft:coal_ore','minecraft:iron_ore','minecraft:gold_ore','minecraft:diamond_ore','minecraft:emerald_ore','minecraft:redstone_ore','minecraft:lapis_ore','minecraft:copper_ore'];
    const ore=ores[Math.floor(Math.random()*ores.length)];give(p,ore,1);
    tell(p,'§eOre reward: '+ore.replace('minecraft:','').replaceAll('_',' '));return;
  }
  const common=['minecraft:amethyst_shard','minecraft:quartz','minecraft:glowstone_dust'];
  give(p,common[Math.floor(Math.random()*common.length)],1+Math.floor(Math.random()*3));
  tell(p,'§7Cloud reward.');
}
function lootReward(p,kind){
  if(kind==='villager'){
    const v=safe(()=>p.dimension.spawnEntity('sparkmod:god_villager',{x:p.location.x+2,y:p.location.y,z:p.location.z}));
    if(v)v.nameTag='§6God Villager';
    tell(p,'§6LEGENDARY! God Villager! §eIt sells max-enchanted diamond gear for emeralds.');return;
  }
  normalLoot(p,kind);
}
function roll(p, selectedRoll){
  const {r}=sparkPrize(selectedRoll);
  const k=rollKind(r);
  giveUniqueRoll(p,k.id);
}
// Deliver any owed rewards from an interrupted gacha animation on reconnect.
world.afterEvents.playerSpawn.subscribe(({player})=>{
  system.runTimeout(()=>{
    const stored=prop(player,'pendingSparkPrizes','');
    if(typeof stored==='string'&&stored){
      setProp(player,'pendingSparkPrizes','');
      const prizes=safe(()=>JSON.parse(stored),[]);
      if(Array.isArray(prizes)){
        tell(player,'§eRestoring your interrupted Spark roll.');
        for(const prize of prizes){
          const r=typeof prize==='number'?prize:prize?.r;
          if(typeof r==='number'&&r>=0&&r<1)roll(player,prize);
        }
      }
    }
    const pending=Math.min(100,Number(prop(player,'pendingGachaRolls',0)));
    if(pending>0){
      setProp(player,'pendingGachaRolls',0);
      tell(player,`§eDelivering ${pending} pending cloud reward(s).`);
      for(let i=0;i<pending;i++)roll(player);
    }
  },40);
});
const RECIPES={
 mace:{out:I.mace,req:[[I.tear,2],['minecraft:mace',1]]},
 saddle:{out:'minecraft:saddle',req:[[I.tear,2],['minecraft:saddle',1],['minecraft:diamond',3],['minecraft:phantom_membrane',3]]},
 awaken:{req:[[I.tear,5]]}
};
// One Spark Moon per 24 real-world hours, active for 30 minutes.
// World dynamic property persists the schedule across restarts.
const SPARK_MOON_PERIOD_MS = 24 * 60 * 60 * 1000;
const SPARK_MOON_DURATION_MS = 30 * 60 * 1000;
function sparkMoonStart() {
 let start = Number(prop(world, 'sparkMoonStart', 0));
 const now = Date.now();
 if (!Number.isFinite(start) || start <= 0) {
   start = now;
   setProp(world, 'sparkMoonStart', start);
 }
 // Catch up missed cycles, including when the world was offline.
 if (now >= start + SPARK_MOON_PERIOD_MS) {
   start += Math.floor((now - start) / SPARK_MOON_PERIOD_MS) * SPARK_MOON_PERIOD_MS;
   setProp(world, 'sparkMoonStart', start);
 }
 return start;
}
function sparkMoonStatus() {
 const start = sparkMoonStart();
 const now = Date.now();
 const active = now >= start && now < start + SPARK_MOON_DURATION_MS;
 return {active, moonId: start, remainingMs: active ? start + SPARK_MOON_DURATION_MS - now : start + SPARK_MOON_PERIOD_MS - now};
}
function formatMoonTime(ms) {
 const secs = Math.ceil(Math.max(0, ms) / 1000);
 const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
 return `${h}h ${m}m ${sec}s`;
}
// Awakening is PER EQUIPPED ARMOR PIECE, not per player. Each costs 5 Spark Tokens.
const ARMOR_SLOTS = [
  ['Helmet',EquipmentSlot.Head,I.helmet],
  ['Chestplate',EquipmentSlot.Chest,I.chest],
  ['Leggings',EquipmentSlot.Legs,I.legs],
  ['Boots',EquipmentSlot.Feet,I.boots]
];
// V137: a towering purple spark column when a Spark piece awakens.
// Uses built-in Bedrock particles to avoid an extra particle texture dependency.
function awakeningPurpleBeam(player) {
 const dim = player.dimension;
 const origin = {...player.location};
 const purple = 'minecraft:basic_portal_particle';
 const mist = 'minecraft:dragon_breath_trail';
 const light = 'minecraft:endrod';
 // V139: 48-block-high, 10-block-wide column with rotating purple walls,
 // bright inner shaft, giant lightning-shaped arcs, and an expanding ground shockwave.
 // Bounded at roughly 160 particles every 3 ticks for mobile Bedrock performance.
 for (let frame=0;frame<48;frame++) {
  system.runTimeout(()=>{
   const spin=frame*0.24;
   // Wide beam shell and inner core reach 48 blocks into the sky.
   for (let level=0;level<=48;level+=4) {
    const y=origin.y+1+level;
    for (let arm=0;arm<8;arm++) {
     const angle=spin+arm*Math.PI/4+level*0.08;
     const radius=4.2+0.55*Math.sin(spin*1.8+level*0.4);
     const pos={x:origin.x+Math.cos(angle)*radius,y,z:origin.z+Math.sin(angle)*radius};
     safe(()=>dim.spawnParticle(purple,pos));
     if(arm%2===0) safe(()=>dim.spawnParticle(mist,pos));
    }
    for(let core=0;core<3;core++){
     const angle=-spin*1.6+core*2*Math.PI/3;
     const pos={x:origin.x+Math.cos(angle)*0.85,y,z:origin.z+Math.sin(angle)*0.85};
     safe(()=>dim.spawnParticle(core===0?light:purple,pos));
    }
   }
   // Four zigzagging lightning-shaped purple arcs reach away from the column.
   if(frame%2===0){
    for(let arc=0;arc<4;arc++){
     const angle=arc*Math.PI/2+spin*0.5;
     for(let step=0;step<6;step++){
      const radius=4.5+step*1.35;
      const jitter=Math.sin(step*3.7+frame*0.8)*1.1;
      const pos={x:origin.x+Math.cos(angle)*radius+Math.cos(angle+Math.PI/2)*jitter,
                 y:origin.y+3+step*2.1,
                 z:origin.z+Math.sin(angle)*radius+Math.sin(angle+Math.PI/2)*jitter};
      safe(()=>dim.spawnParticle(step%2===0?light:purple,pos));
     }
    }
   }
   // Expanding circular shockwave at ground level, 14 blocks across.
   if(frame<20){
    const ring=1.5+frame*0.55;
    for(let j=0;j<16;j++){
     const angle=j*Math.PI/8+spin*0.25;
     safe(()=>dim.spawnParticle(j%4===0?light:purple,{
      x:origin.x+Math.cos(angle)*ring,
      y:origin.y+0.3,
      z:origin.z+Math.sin(angle)*ring
     }));
    }
   }
  },frame*3);
 }
}

// V245: awakening anything makes the Spark Shrine fire a massive beam into the Spark Moon,
// which blazes bright with a golden halo while a thunderstorm rolls in.
function moonDirection(){
 const a=2*Math.PI*(safe(()=>world.getTimeOfDay(),18000)/24000);
 const sun={x:Math.cos(a),y:Math.sin(a),z:0};
 const moon={x:-sun.x,y:-sun.y,z:0};
 if(moon.y>0.25)return moon;                       // the real moon is up: aim at it
 return {x:0.25,y:0.97,z:0};                       // daytime Spark Moon: high overhead
}
function shrineAltar(p){
 const d=p.dimension,c=p.location;
 for(let x=-6;x<=6;x++)for(let y=-3;y<=4;y++)for(let z=-6;z<=6;z++){
  const b=safe(()=>d.getBlock({x:Math.floor(c.x)+x,y:Math.floor(c.y)+y,z:Math.floor(c.z)+z}));
  if(b?.typeId===I.altar)return {x:b.location.x+.5,y:b.location.y+1.2,z:b.location.z+.5};
 }
 return {x:c.x,y:c.y+1,z:c.z};
}
function shrineMoonBeam(p){
 const d=p.dimension,o=shrineAltar(p),dir=moonDirection();
 const L=Math.hypot(dir.x,dir.y,dir.z),u={x:dir.x/L,y:dir.y/L,z:dir.z/L};
 // thunderstorm + sound
 if(d.id==='minecraft:overworld')safe(()=>d.setWeather(WeatherType.Thunder,6000));
 F.sfx(d,'sparkmod.titan.charge_long',o,4,1.2);
 system.runTimeout(()=>{F.sfx(d,'sparkmod.titan.beam',o,8,.7);F.sfx(d,'sparkmod.titan.shine',o,8,1.1);
  safe(()=>d.playSound('ambient.weather.thunder',o,{volume:10,pitch:.7}));},20);
 // charge at the altar
 for(let t=0;t<20;t+=2)system.runTimeout(()=>{F.converge(d,o,4-t/8,24,F.C.gold);F.orb(d,o,1+t/6,F.C.gold,.2);},t);
 // the beam: 3 seconds at full power, then fading out
 for(let k=0;k<40;k++)system.runTimeout(()=>{
  const fade=k<30?1:1-(k-29)/11;
  for(let s=1;s<=140;s+=1.6){
   const q={x:o.x+u.x*s,y:o.y+u.y*s,z:o.z+u.z*s};
   F.orb(d,q,3.4*fade+.4,F.C.gold,.25,.85*fade);F.orb(d,q,1.6*fade+.2,F.C.white,.25,fade);
  }
  if(k%4===0&&k<30){const a=Math.random()*Math.PI*2;F.arc(d,o,{x:o.x+u.x*60+Math.cos(a)*3,y:o.y+u.y*60,z:o.z+u.z*60+Math.sin(a)*3},{color:F.C.white,size:.5,jag:2,branches:2,max:180});}
  if(k%6===0&&k<30)F.pulse(d,o,6+k/3,F.C.gold,.6);
 },20+k*2);
 F.shock(d,o,8,F.C.gold,1);F.shake(d,o,64,1.5,1.2);
 // lightning around the shrine
 for(let k=0;k<6;k++)system.runTimeout(()=>{const a=k*Math.PI/3,q={x:o.x+Math.cos(a)*9,y:o.y,z:o.z+Math.sin(a)*9};safe(()=>d.spawnEntity('minecraft:lightning_bolt',q));},24+k*6);
 // the moon blazes for 10 seconds (drawn for everyone in the dimension, where they see the moon)
 for(let k=0;k<100;k++)system.runTimeout(()=>{
  const glow=k<70?1:1-(k-69)/31,pulse=1+.08*Math.sin(k*.5);
  for(const q of safe(()=>d.getPlayers(),[])){
   const e={x:q.location.x,y:q.location.y+1.62,z:q.location.z},D=60;
   const m={x:e.x+u.x*D,y:e.y+u.y*D,z:e.z+u.z*D};
   F.pfx(q,'fx_orb',m,{size:9*pulse*glow+1,life:.2,color:F.C.white,alpha:glow});
   F.pfx(q,'fx_orb',m,{size:22*pulse*glow+2,life:.2,color:F.C.gold,alpha:.55*glow});
   F.pfx(q,'sun_corona',m,{size:16*pulse,life:.2,color:F.C.gold,alpha:.9*glow});
   if(k%10===0)F.pfx(q,'fx_pulse',m,{size:40,life:1,color:F.C.gold,alpha:glow});
  }
 },30+k*2);
 for(const q of safe(()=>d.getPlayers({location:o,maxDistance:200}),[]))
  safe(()=>q.onScreenDisplay.setTitle('§6§l⚡ THE SPARK MOON BLAZES ⚡',{subtitle:`§e${p.name} awakened Spark gear at the Shrine`,fadeInDuration:10,stayDuration:50,fadeOutDuration:20}));
}
function awakenedPiece(item){return item?.getDynamicProperty('sparkmod:awakened')===true;}
function awakenPiece(p,index){
 const moon = sparkMoonStatus();
 if (!moon.active) {tell(p,`§cArmor awakening is only possible during a Spark Moon. Next moon in ${formatMoonTime(moon.remainingMs)}.`);return;}
 // V239: no limit - every piece can be awakened.
 const entry=ARMOR_SLOTS[index]; if(!entry)return;
 const [name,slot,id]=entry;
 const eq=p.getComponent('minecraft:equippable');
 const item=eq?.getEquipment(slot);
 if(item?.typeId!==id){tell(p,`Equip Spark ${name} first.`);return;}
 if(awakenedPiece(item)){tell(p,`Spark ${name} is already awakened.`);return;}
 if(count(p,I.tear)<5){tell(p,'You need 5 Spark Tokens for this piece.');return;}
 // Write item state first. The marker stays on the item when moved or traded.
 try {
   item.setDynamicProperty('sparkmod:awakened',true);
   item.nameTag=`§6Awakened Spark ${name}`;
   eq.setEquipment(slot,item);
 }catch(e){tell(p,'Could not awaken armor: '+String(e));return;}
 if(!take(p,I.tear,5)){
   // Revert if inventory changed before payment.
   item.setDynamicProperty('sparkmod:awakened',false);
   item.nameTag=`Spark ${name}`;
   eq.setEquipment(slot,item);
   tell(p,'Payment failed; awakening reverted.');return;
 }
 setProp(p,'lastAwakeningMoon',moon.moonId);
 awakeningPurpleBeam(p);
 shrineMoonBeam(p);
 tell(p,`§e⚡ Spark ${name} awakened! 5 Spark Tokens consumed.`);
 if(name==='Chestplate')tell(p,'§6⚡ SPARK MODE UNLOCKED: a hit that would kill you instead makes you IMMORTAL for 10 seconds (Speed IV, Strength II, lightning on everyone nearby). Recharge it at the Spark Shrine afterwards.');
}
function awakenSword(p){
 const moon=sparkMoonStatus();
 if(!moon.active){tell(p,`§cSword awakening requires a Spark Moon. Next moon in ${formatMoonTime(moon.remainingMs)}.`);return;}
 // V239: no limit - every piece can be awakened.
 const eq=p.getComponent('minecraft:equippable');
 const sword=eq?.getEquipment(EquipmentSlot.Mainhand);
 if(sword?.typeId===I.awakenedSword){tell(p,'Your sword is already awakened.');return;}
 if(sword?.typeId!==I.sword){tell(p,'Hold a regular Spark Sword in your main hand.');return;}
 if(count(p,I.tear)<5){tell(p,'You need 5 Spark Tokens to awaken your sword.');return;}
 try{
  const awakened=new ItemStack(I.awakenedSword,1);
  awakened.nameTag='§6⚡ Awakened Spark Sword';
  eq.setEquipment(EquipmentSlot.Mainhand,awakened);
 }catch(e){tell(p,'Sword awakening failed: '+String(e));return;}
 if(!take(p,I.tear,5)){
  safe(()=>eq.setEquipment(EquipmentSlot.Mainhand,sword));
  tell(p,'Payment failed; original sword restored.');return;
 }
 setProp(p,'lastAwakeningMoon',moon.moonId);
 awakeningPurpleBeam(p);
 shrineMoonBeam(p);
 awakenedWeaponSparks(p,'sword',true);
 tell(p,'§e⚡ Spark Sword awakened! New lightning crystal texture unlocked.');
}
function awakenMace(p){
 const moon=sparkMoonStatus();
 if(!moon.active){tell(p,'Spark Mace awakening requires an active Spark Moon.');return;}
 // V239: no limit - every piece can be awakened.
 if(!isSparkMace(p)){tell(p,'Hold your Spark Mace in your main hand.');return;}
 const eq=p.getComponent('minecraft:equippable');
 const mace=eq?.getEquipment(EquipmentSlot.Mainhand);
 if(!mace)return;
 if(awakenedPiece(mace)){tell(p,'Your Spark Mace is already awakened.');return;}
 if(count(p,I.tear)<5){tell(p,'You need 5 Spark Tokens to awaken the mace.');return;}
 try{
  mace.setDynamicProperty('sparkmod:awakened',true);
  mace.nameTag='§5⚡ Awakened Spark Mace';
  const lore=mace.getLore?.()??[];
  mace.setLore([...new Set([...lore,SPARK_MACE_LORE,'§5Awakened with Spark Moon energy'])]);
  eq.setEquipment(EquipmentSlot.Mainhand,mace);
 }catch(e){tell(p,'Could not awaken Spark Mace: '+String(e));return;}
 if(!take(p,I.tear,5)){
  safe(()=>{
   mace.setDynamicProperty('sparkmod:awakened',false);
   mace.nameTag='§6Spark Mace';
   eq.setEquipment(EquipmentSlot.Mainhand,mace);
  });
  return;
 }
 setProp(p,'lastAwakeningMoon',moon.moonId);
 awakeningPurpleBeam(p);
 shrineMoonBeam(p);
 tell(p,'§5⚡ Spark Mace awakened! Its native smash mechanics are preserved.');
}
function craft(p,type){
 const r=RECIPES[type];
 if(!r||type==='awaken')return;
 if(type==='mace'){
  if(String(prop(world,'uniqueSparkRolls','')).split('|').includes(I.mace)){
    tell(p,'§cThe world-exclusive Spark Mace has already been claimed.');return;
  }
  const container=bag(p); let ordinary=0;
  if(container)for(let i=0;i<container.size;i++){
   const stack=container.getItem(i);
   if(stack?.typeId===I.mace && !((stack.getLore?.()??[]).includes(SPARK_MACE_LORE)) && stack.nameTag!=='§6Spark Mace')ordinary+=stack.amount;
  }
  if(ordinary<1){tell(p,'§cYou need a normal Mace, not an existing Spark Mace.');return;}
 }
 if(r.req.some(([id,n])=>count(p,id)<n)){tell(p,'Missing materials.');return;}
 if(type==='mace'){
  // One Spark Mace total across survival crafting and gacha. Creative copies are independent.
  const claimed=claimSpecificUniqueRoll(I.mace);
  if(!claimed){tell(p,'§cSpark Mace already claimed.');return;}
  take(p,I.tear,2);
  const b=bag(p);
  if(b)for(let i=0;i<b.size;i++){
   const stack=b.getItem(i);
   if(stack?.typeId===I.mace && !(stack.getLore?.()??[]).includes(SPARK_MACE_LORE) && stack.nameTag!=='§6Spark Mace'){
    if(stack.amount===1)b.setItem(i,undefined);else{stack.amount--;b.setItem(i,stack);}break;
   }
  }
 }else for(const [id,n] of r.req)take(p,id,n);
 give(p,r.out);tell(p,'§bCrafted '+type+'.');
}
// V159: One Sparkite upgrade per Spark weapon or armor piece.
// Armor upgrade provides 5% additional damage mitigation while worn.
const FORGE_COST=5;
const FORGE_LEVEL='sparkmod:forge_level';
const FORGE_ITEMS=[
 ['Spark Sword',EquipmentSlot.Mainhand,[I.sword,I.awakenedSword]],
 ['Spark Mace',EquipmentSlot.Mainhand,[I.mace]],
 ['Spark Helmet',EquipmentSlot.Head,[I.helmet,I.helmetV3]],
 ['Spark Chestplate',EquipmentSlot.Chest,[I.chest,I.chestV3]],
 ['Spark Leggings',EquipmentSlot.Legs,[I.legs,I.legsV3]],
 ['Spark Boots',EquipmentSlot.Feet,[I.boots,I.bootsV3]]
];
function forgeTier(item){
 if(!item)return 0;
 if([I.chestV3,I.helmetV3,I.legsV3,I.bootsV3].includes(item.typeId))return 1;
 return Math.max(0,Math.min(1,Number(safe(()=>item.getDynamicProperty(FORGE_LEVEL),0))||0));
}
function copyForgeItem(item,newType){
 const out=new ItemStack(newType,1);
 const oldEnch=safe(()=>item.getComponent('minecraft:enchantable')?.getEnchantments(),[]);
 const target=safe(()=>out.getComponent('minecraft:enchantable'));
 for(const enchant of oldEnch)safe(()=>target?.addEnchantment(enchant));
 const oldDur=safe(()=>item.getComponent('minecraft:durability'));
 const newDur=safe(()=>out.getComponent('minecraft:durability'));
 if(oldDur&&newDur)safe(()=>newDur.damage=oldDur.damage);
 const oldLore=safe(()=>item.getLore(),[]);
 if(oldLore.length)safe(()=>out.setLore(oldLore));
 if(item.nameTag)out.nameTag=item.nameTag;
 if(safe(()=>item.getDynamicProperty('sparkmod:awakened'),false))safe(()=>out.setDynamicProperty('sparkmod:awakened',true));
 return out;
}
// Cosmetic bolts on the forging player; real lightning targets other nearby entities.
// Lightning can still harm OTHER players/mobs and cause fires, as requested.
function v3LightningCelebration(player){
 const dimension=player.dimension;
 const center={...player.location};
 let spawned=0;
 const job=system.runInterval(()=>{
  if(!valid(player)){system.clearRun(job);return;}
  for(let j=0;j<5&&spawned<250;j++,spawned++){
   if(spawned<25){
    const pos={...player.location};
    for(let segment=0;segment<12;segment++){
     const jitter=(segment%3-1)*0.22;
     safe(()=>dimension.spawnParticle('minecraft:basic_crit_particle',{x:pos.x+jitter,y:pos.y+segment*0.85,z:pos.z-jitter}));
    }
   }else{
    const nearby=safe(()=>dimension.getEntities({location:center,maxDistance:100}).filter(e=>e.id!==player.id&&e.typeId!=='minecraft:item'&&e.typeId!=='minecraft:xp_orb'&&e.typeId!=='minecraft:lightning_bolt'&&e.typeId!=='minecraft:armor_stand'&&((e.location.x-player.location.x)**2+(e.location.z-player.location.z)**2)>64),[]);
    if(nearby.length){
     const target=nearby[Math.floor(Math.random()*nearby.length)];
     safe(()=>dimension.spawnEntity('minecraft:lightning_bolt',{x:target.location.x,y:target.location.y,z:target.location.z}));
    }
   }
  }
  if(spawned>=250)system.clearRun(job);
 },5);
}
async function forgeUI(p){
 const form=new ActionFormData().title('§6⚒ Spark Forge')
 .body(`Upgrade each Spark weapon or armor piece ONE TIME for §e5 Sparkite§r.
Weapons: +20% damage. Armor: +5% damage reduction.
An upgrade triggers 25 safe player lightning visuals and 225 strikes on nearby entities.`);
 for(const [name,slot,types] of FORGE_ITEMS){
  const item=equipment(p,slot);
  const matches=item&&types.includes(item.typeId)&&(name!=='Spark Mace'||isSparkMace(p));
  form.button(`${name} — ${matches?(forgeTier(item)?'UPGRADED':'Ready to upgrade'):'Not equipped'}`);
 }
 form.button('Back');
 const result=await showForm(p,form);
 if(!result||result.canceled||result.selection>=FORGE_ITEMS.length)return;
 const [name,slot,types]=FORGE_ITEMS[result.selection];
 const eq=safe(()=>p.getComponent('minecraft:equippable'));
 const item=eq?.getEquipment(slot);
 if(!item||!types.includes(item.typeId)||(name==='Spark Mace'&&!isSparkMace(p))){p.sendMessage('§cEquip the selected Spark item first.');return;}
 if(forgeTier(item)>=1){p.sendMessage(`§e${name} has already been upgraded.`);return;}
 if(count(p,I.sparkite)<FORGE_COST){p.sendMessage(`§cYou need ${FORGE_COST} Sparkite. You have ${count(p,I.sparkite)}.`);return;}
 try{
  const v3Types={'Spark Chestplate':I.chestV3,'Spark Helmet':I.helmetV3,'Spark Leggings':I.legsV3,'Spark Boots':I.bootsV3};
  const replacement=copyForgeItem(item,v3Types[name]||item.typeId);
  replacement.setDynamicProperty(FORGE_LEVEL,1);
  const originalLore=replacement.getLore().filter(x=>!x.includes('Spark Forge V')&&!x.includes('Spark Forge Upgrade'));
  replacement.setLore([...originalLore,`§6⚒ Spark Forge Upgrade (${v3Types[name]?'+5% defense':'+20% damage'})`]);
  if(!take(p,I.sparkite,FORGE_COST)){p.sendMessage('§cSparkite payment failed.');return;}
  try{eq.setEquipment(slot,replacement);}catch(err){give(p,I.sparkite,FORGE_COST);throw err;}
  p.sendMessage(`§6⚒ ${name} upgraded! §eLightning awakening activated!`);
  v3LightningCelebration(p);
  safe(()=>p.playSound('random.anvil_use',{volume:1,pitch:1.2}));
 }catch(err){p.sendMessage('§cForge failed: '+String(err));}
}
// Apply 5% extra mitigation for each upgraded Spark armor piece, using a post-hit
// health refund. This cannot prevent an otherwise fatal hit in the Bedrock API.
world.afterEvents.entityHurt.subscribe(ev=>{
 const victim=ev.hurtEntity;
 if(victim?.typeId!=='minecraft:player'||!(ev.damage>0))return;
 const health=safe(()=>victim.getComponent('minecraft:health'));
 if(!health||health.currentValue<=0)return;
 let pieces=0;
 for(const slot of [EquipmentSlot.Head,EquipmentSlot.Chest,EquipmentSlot.Legs,EquipmentSlot.Feet]){
  const item=equipment(victim,slot);
  if(item&&forgeTier(item)>0&&FORGE_ITEMS.some(([name,s,types])=>s===slot&&types.includes(item.typeId)))pieces++;
 }
 if(pieces>0)safe(()=>health.setCurrentValue(Math.min(health.effectiveMax,health.currentValue+ev.damage*Math.min(0.20,pieces*0.05))));
});
// Only one extra-damage application per confirmed weapon hit. This applies to
// Spark Sword and native Spark Mace and preserves their original mechanics.
world.afterEvents.entityHurt?.subscribe(ev=>{
 const player=ev.damageSource?.damagingEntity;
 if(player?.typeId!=='minecraft:player'||!valid(ev.hurtEntity)||areTeammates(player,ev.hurtEntity))return;
 if(!['entityAttack','maceSmash'].includes(ev.damageSource?.cause))return;
 const weapon=equipment(player,EquipmentSlot.Mainhand);
 if(!weapon||!(isSparkSword(weapon.typeId)||isSparkMace(player)))return;
 const tier=forgeTier(weapon);
 if(tier<1)return;
 const extra=Math.max(0,Number(ev.damage)||0)*0.2*tier;
 if(extra>0)safe(()=>ev.hurtEntity.applyDamage(extra));
});
// V147: A single world-wide Colosseum Warden victory unlocks the altar for everyone.
const ALTAR_UNLOCK='sparkmod:colosseum_warden_cleared';
function hasAltarAccess(p){return true;} // Old Colosseum Warden requirement retired; Spark Moon and token costs remain.
function altarUI(p){system.run(async()=>{
 if(!hasAltarAccess(p)){
  tell(p,'§c§lSpark Altar LOCKED! §r§7Defeat the Colosseum Warden at X=1750, Z=1500 to unlock it for EVERYONE. Put §b1 Diamond §7in the Colosseum chest to summon the Bolt Titan.');
  return;
 }

 const chestState=sparkChestStatus(p);
 const form=new ActionFormData().title('Spark Shrine')
 .body(`Awaken ANY of your Spark pieces during a Spark Moon - 5 Spark Tokens each, no limit.\nSpark Moon: ${sparkMoonStatus().active ? '§aACTIVE' : '§cINACTIVE'}\n${sparkMoonStatus().active ? 'Ends in' : 'Next in'}: ${formatMoonTime(sparkMoonStatus().remainingMs)}`)
 .button('Craft Spark Mace')
 .button('Awaken Helmet — 5 Tokens').button('Awaken Chestplate — 5 Tokens')
 .button('Awaken Leggings — 5 Tokens').button('Awaken Boots — 5 Tokens').button('Awaken Held Spark Sword — 5 Tokens').button('Awaken Held Spark Mace — 5 Tokens').button('§6⚒ Spark Forge — Upgrade with Sparkite')
 .button(chestState==='charged'?(sparkChestAwakened(p)?'§7Spark Mode: charged':'§7Spark Mode: awaken the Chestplate to unlock'):'§6⚡ Recharge Spark Chestplate — 3 Tokens')
 .button('§6⚡ Forge Spark Bow — 1 Bow + 8 Tokens');
 // V238: Spark Bow awakening / reactivation button appears while holding a Spark Bow.
 const bowLabel=sparkBowShrineLabel(p);
 if(bowLabel)form.button(bowLabel);
 form.button('Close');
 const r=await showForm(p,form);if(!r||r.canceled)return;
 if(r.selection===9){forgeSparkBow(p);return;}
 if(bowLabel&&r.selection===10){if(/Awaken/.test(bowLabel))awakenSparkBow(p);else if(/Reactivate/.test(bowLabel))rechargeSparkBow(p);return;}
 if(r.selection===0)craft(p,'mace');
 else if(r.selection>=1&&r.selection<=4)awakenPiece(p,r.selection-1);
 else if(r.selection===5)awakenSword(p);
 else if(r.selection===6)awakenMace(p);
 else if(r.selection===7)forgeUI(p);
 else if(r.selection===8)rechargeSparkChest(p,()=>take(p,I.tear,3));
});}
function blockAt(dim,pos){return safe(()=>dim.getBlock({x:Math.floor(pos.x),y:Math.floor(pos.y),z:Math.floor(pos.z)}));}
function place(dim,pos,id){safe(()=>blockAt(dim,pos)?.setType(id));}
function buildAltar(dim,pos){const {x,y,z}=pos;for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)place(dim,{x:x+dx,y,z:z+dz},'minecraft:polished_blackstone_bricks');place(dim,{x,y:y+1,z},I.altar);}
const sparkTokenUseTimes=new Map();
function triggerSparkToken(p){
 if(!p||p.typeId!=='minecraft:player')return;
 const now=Date.now(),last=sparkTokenUseTimes.get(p.id)||0;
 if(now-last<900)return;
 sparkTokenUseTimes.set(p.id,now);
 showSparkTokenMenu(p);
}
// Register a real item-use component; itemUse is kept as a fallback.
system.beforeEvents.startup.subscribe(({itemComponentRegistry})=>{
 itemComponentRegistry.registerCustomComponent('sparkmod:token_use',{
  onUse(event){const player=event.source;system.run(()=>triggerSparkToken(player));}
 });
});
// V56 stable diagnostics and fallback commands. Minecraft cheat command:
//   /scriptevent sparkmod:ping
//   /scriptevent sparkmod:token
// Only messages from in-game entities are accepted.
system.afterEvents.scriptEventReceive.subscribe(e=>{
 if(e.id!=='sparkmod:ping'&&e.id!=='sparkmod:token')return;
 const p=e.sourceEntity;
 if(!p||p.typeId!=='minecraft:player')return;
 if(e.id==='sparkmod:ping'){
   tell(p,'§aSparkMod V214 gameplay script is running! Token ID: sparkmod:spark_token');
   return;
 }
 if(count(p,I.tear)<1){tell(p,'You need a Spark Token in your inventory.');return;}
 triggerSparkToken(p);
});
// A short sign-in acknowledgement helps distinguish failure to load the script
// from failure to register one particular item interaction.
world.afterEvents.playerSpawn.subscribe(({player,initialSpawn})=>{
 if(initialSpawn)system.runTimeout(()=>{
  if(valid(player))tell(player,'§aSparkMod V214 loaded. Use /scriptevent sparkmod:diagnose to check structures.');
 },80);
});
// Diagnostic command for checking whether scripts and structures actually loaded.
system.afterEvents.scriptEventReceive.subscribe(e=>{
 if(e.id!=='sparkmod:diagnose')return;
 const p=e.sourceEntity;if(p?.typeId!=='minecraft:player')return;
 const temple=world.getDynamicProperty('sparkmod:temple_custom_v166_placed')===true;
 const arena=world.getDynamicProperty('sparkmod:underground_pvp_arena_v167_placed')===true;
 tell(p,'§aSparkMod V204 scripts active. Temple: '+(temple?'placed':'not yet placed')+'; Underground Arena: '+(arena?'placed':'not yet placed'));
 tell(p,`§7Spark Shrine: X${siteOf('shrine').x} Z${siteOf('shrine').z}. Colosseum: X${siteOf('colosseum').x} Z${siteOf('colosseum').z}. Other structures appear on the plains as you explore (/scriptevent sparkmod:structures).`);
});
// V186: in-game verification. Run /scriptevent sparkmod:health
system.afterEvents.scriptEventReceive.subscribe(e => {
 if(e.id!=='sparkmod:health') return;
 const p=e.sourceEntity;
 if(p?.typeId!=='minecraft:player') return;
 tell(p,'§a§lSparkMod V204 script: ACTIVE');
 tell(p,'§7Spark Tokens in inventory: §e'+count(p,I.tear));
 const structures=['temple_of_sparks','colosseum_of_sparks','underground_pvp_arena','tower_graveyard','spark_castle'];
 try {
  const known=new Set(world.structureManager.getPackStructureIds());
  tell(p,'§7Structures registered: '+structures.map(s => (known.has('sparkmod:'+s)?'§a✓':'§c✗')+s).join(' §7| '));
 } catch(err) {tell(p,'§cStructure lookup error: '+String(err).slice(0,120));}
 const check=[['Temple','sparkmod:temple_custom_v166_placed'],['Colosseum','sparkmod:colosseum_sparks_v182_placed'],['Arena','sparkmod:underground_pvp_arena_v167_placed']];
 tell(p,'§7Placed: '+check.map(([name,key])=>name+'='+String(world.getDynamicProperty(key)===true)).join('; '));
 tell(p,'§7Visit structure center in a newly generated test world to trigger placement.');
});
// V55: interaction fallback for Bedrock touch controls.
// Sneak while holding the Spark Token to open its menu even when custom onUse
// isn't emitted by a specific Bedrock build.
const tokenSneakPrevious=new Map();
system.runInterval(()=>{
 for(const player of world.getAllPlayers()){
  const sneaking=player.isSneaking===true;
  const old=tokenSneakPrevious.get(player.id)||false;
  tokenSneakPrevious.set(player.id,sneaking);
  if(sneaking&&!old&&held(player)===I.tear)triggerSparkToken(player);
 }
},2);
function showSparkTokenMenu(p){
  // Open the functional roll menu directly, avoiding a second overlapping form.
  showGacha(p);
}
// V59: Entire Spark Sky generation system removed.
const SPARK_BUILD_VERSION=59;
function startWorld(){console.warn('[SparkMod] V74 loaded. Spark Dimension generation disabled.');}
// Permanent teammate pairs are stored in world dynamic properties.
// Invitations require acceptance; there is no unteam command by design.
const teammateInvites = new Map();
const teammateKey = name => name.toLowerCase();
function teammateBook(){
  try { const data=JSON.parse(prop(world,'teammates','{}')); return data&&typeof data==='object'?data:{}; }
  catch {return {};}
}
// V149: a team is a connected group, capped at five players INCLUDING its creator.
const SPARK_TEAM_LIMIT=5;
function teamMembers(name,book=teammateBook()){
 const seen=new Set(),queue=[teammateKey(name)];
 while(queue.length){const key=queue.shift();if(seen.has(key))continue;seen.add(key);
   for(const other of book[key]||[])if(!seen.has(other))queue.push(other);
 }
 return seen;
}
function teammatesOf(p){return [...teamMembers(p.name)].filter(n=>n!==teammateKey(p.name));}
function areTeammates(a,b){return a?.typeId==='minecraft:player'&&b?.typeId==='minecraft:player'&&a.id!==b.id&&teamMembers(a.name).has(teammateKey(b.name));}
function linkTeammates(a,b){
 const book=teammateBook(),ak=teammateKey(a.name),bk=teammateKey(b.name);
 const left=teamMembers(ak,book),right=teamMembers(bk,book);
 if(left.has(bk))return 'already';
 if(new Set([...left,...right]).size>SPARK_TEAM_LIMIT)return 'full';
 // Merge entire groups so teammate checks apply to all five members.
 const merged=[...new Set([...left,...right])];
 for(const name of merged)book[name]=merged.filter(n=>n!==name);
 setProp(world,'teammates',JSON.stringify(book));
 return 'added';
}
function teammateCommand(p,message){
  const parts=message.trim().split(/\s+/),action=parts[1]?.toLowerCase();
  if(action==='list'){tell(p,'Permanent teammates: '+(teammatesOf(p).join(', ')||'none'));return;}
  if(action==='invite'){
    const target=world.getAllPlayers().find(x=>x.name.toLowerCase()===parts.slice(2).join(' ').toLowerCase());
    if(!target||target.id===p.id){tell(p,'Usage: !sparkteam invite <online player name>');return;}
    if(areTeammates(p,target)){tell(p,'Already teammates forever.');return;}
    if(new Set([...teamMembers(p.name),...teamMembers(target.name)]).size>SPARK_TEAM_LIMIT){tell(p,'§cTeam limit is 5 players including yourself.');return;}
    teammateInvites.set(teammateKey(target.name),{from:teammateKey(p.name),expires:Date.now()+120000});
    tell(p,'Invite sent to '+target.name+'.');tell(target,p.name+' invited you to be permanent teammates. Type !sparkteam accept '+p.name+' within 2 minutes.');return;
  }
  if(action==='accept'){
    const sender=world.getAllPlayers().find(x=>x.name.toLowerCase()===parts.slice(2).join(' ').toLowerCase());
    const invite=teammateInvites.get(teammateKey(p.name));
    if(!sender||!invite||invite.from!==teammateKey(sender.name)||Date.now()>invite.expires){tell(p,'No valid invitation from that player.');return;}
    const result=linkTeammates(p,sender);if(result==='full'){tell(p,'§cTeam limit is 5 players including yourself.');return;}teammateInvites.delete(teammateKey(p.name));
    tell(p,'You and '+sender.name+' are now permanent teammates!');tell(sender,p.name+' accepted. You are permanent teammates!');return;
  }
  tell(p,'!sparkteam invite <name>, !sparkteam accept <name>, !sparkteam list');
}

// V151: Request-based team system. No player may silently add someone else.
function openTeammateForm(p){
 const form=new ModalFormData().title('§6⚡ SparkMod Teammates')
   .textField('Enter the username of an ONLINE player on this world or Realm:', 'Minecraft username');
 form.show(p).then(response=>{
  if(response.canceled)return;
  const name=String(response.formValues?.[0]??'').trim();
  if(!name){tell(p,'§cEnter a player username.');return;}
  const target=world.getAllPlayers().find(q=>q.name.toLowerCase()===name.toLowerCase());
  if(!target){tell(p,'§cThat player is not online.');return;}
  if(target.id===p.id){tell(p,'§cYou cannot invite yourself.');return;}
  if(areTeammates(p,target)){tell(p,'§eYou are already teammates.');return;}
  if(new Set([...teamMembers(p.name),...teamMembers(target.name)]).size>SPARK_TEAM_LIMIT){tell(p,'§cThe merged team would exceed 5 players.');return;}
  teammateInvites.set(teammateKey(target.name),{from:teammateKey(p.name),expires:Date.now()+120000});
  tell(p,'§aTeam request sent to '+target.name+' (expires in 2 minutes).');
  tell(target,'§6⚡ '+p.name+' invited you to their Spark team! Type §a!accept §6or §c!deny §6within 2 minutes.');
 }).catch(()=>tell(p,'§cCould not open the teammate form. Close chat and use the Teammate Compass again.'));
}
function replyToTeamRequest(p,accept){
 const key=teammateKey(p.name),invite=teammateInvites.get(key);
 if(!invite||Date.now()>invite.expires){teammateInvites.delete(key);tell(p,'§cNo active team request.');return;}
 teammateInvites.delete(key);
 const sender=world.getAllPlayers().find(q=>teammateKey(q.name)===invite.from);
 if(!sender){tell(p,'§cThe inviting player is no longer online.');return;}
 if(!accept){tell(p,'§eTeam request denied.');tell(sender,'§c'+p.name+' denied your team request.');return;}
 const result=linkTeammates(sender,p);
 if(result==='full'){tell(p,'§cTeam limit is 5 players.');tell(sender,'§cTeam merge failed: 5-player limit.');return;}
 if(result==='already'){tell(p,'§eYou are already teammates.');return;}
 tell(p,'§aYou joined '+sender.name+'\'s team! Friendly fire is disabled.');
 tell(sender,'§a'+p.name+' accepted your team request!');
}
// Keep /scriptevent as an optional alternative that opens the same consent-based UI.
system.afterEvents.scriptEventReceive.subscribe(ev=>{
 if(ev.id==='sparkmod:teammate' && ev.sourceEntity?.typeId==='minecraft:player')openTeammateForm(ev.sourceEntity);
});
// V106: On Thor activation, call down ten timed lightning strikes on nearby enemies.
function thorLightningStorm(p){
  const center={...p.location},dim=p.dimension;
  for(let i=0;i<10;i++){
    system.runTimeout(()=>{
      if(!valid(p))return;
      const targets=safe(()=>dim.getEntities({location:center,maxDistance:10})
        .filter(e=>valid(e)&&e.id!==p.id
          &&(e.typeId==='minecraft:player'||e.hasComponent('minecraft:health'))
          &&!areTeammates(p,e)),[]);
      if(!targets.length)return;
      const target=targets[i%targets.length];
      const spot={...target.location};
      lightning(dim,spot);
      F.bolt(dim,{x:spot.x,y:spot.y+18,z:spot.z},{x:spot.x,y:spot.y+1,z:spot.z},{color:F.C.white,size:.5,branches:3},6);
      F.shock(dim,spot,3,F.C.gold,.5);F.sfx(dim,'sparkmod.titan.zap',spot,2,.8);
      safe(()=>dim.spawnParticle('minecraft:basic_smoke_particle',spot));
    },i*5);
  }
}
// V105: Thor Mode defensive blink and awakened teammate shield.
const THOR_DEFENSE_MS=3*60*1000;
const THOR_ALLY_SHIELD_MS=10*1000;
const thorBlinkTicks=new Map();
function isThorProtected(p){
 return p?.typeId==='minecraft:player' &&
  (Date.now()<Number(prop(p,'thorDefenseUntil',0)) ||
   Date.now()<Number(prop(p,'thorAllyShieldUntil',0)));
}
function blinkFromThreat(p,attacker){
 const tick=system.currentTick;
 if(tick-(thorBlinkTicks.get(p.id)??-999)<5)return;
 thorBlinkTicks.set(p.id,tick);
 const pos=p.location, from=attacker?.location;
 let dx=from?pos.x-from.x:Math.cos(p.getRotation().y*Math.PI/180);
 let dz=from?pos.z-from.z:Math.sin(p.getRotation().y*Math.PI/180);
 const length=Math.max(0.001,Math.hypot(dx,dz));
 const dest={x:pos.x+2*dx/length,y:pos.y,z:pos.z+2*dz/length};
 // Check that the destination has room for a player before teleporting.
 const clear=safe(()=>{
  const x=Math.floor(dest.x),y=Math.floor(dest.y),z=Math.floor(dest.z);
  const feet=p.dimension.getBlock({x,y,z});
  const head=p.dimension.getBlock({x,y:y+1,z});
  return !!feet?.isAir&&!!head?.isAir;
 },false);
 if(clear)safe(()=>p.teleport(dest,{dimension:p.dimension,checkForBlocks:true}));
 safe(()=>p.dimension.spawnParticle('minecraft:basic_smoke_particle',{x:pos.x,y:pos.y+1,z:pos.z}));
}
// Teammates are immune to each other's direct damage when the pre-hurt event is supported.
// Other scripted SparkMod attacks must continue using areTeammates checks.
// Cancel teammate damage at the pre-damage stage when the API exposes it.
// This covers direct attacks and projectiles with an attributed player source.
world.beforeEvents.entityHurt?.subscribe(ev=>{
  const victim=ev.hurtEntity,attacker=ev.damageSource?.damagingEntity;
  if(areTeammates(victim,attacker)){ev.cancel=true;return;}
  if(isThorProtected(victim)){
    ev.cancel=true;
    if(Date.now()<Number(prop(victim,'thorDefenseUntil',0)))
      system.run(()=>blinkFromThreat(victim,attacker));
  }
});
// Fallback when cancellable pre-damage hooks are unavailable.
world.afterEvents.entityHurt?.subscribe(ev=>{
 const p=ev.hurtEntity;
 if(!isThorProtected(p))return;
 if(Date.now()<Number(prop(p,'thorDefenseUntil',0)))
   system.run(()=>blinkFromThreat(p,ev.damageSource?.damagingEntity));
 safe(()=>{const hp=p.getComponent('minecraft:health');if(hp)hp.setCurrentValue(hp.effectiveMax);});
});
system.runInterval(()=>{
 for(const p of world.getAllPlayers()){
  if(isThorProtected(p)){
   // Resistance V blocks most ordinary damage, but not every Bedrock damage source.
   safe(()=>p.addEffect('resistance',30,{amplifier:4,showParticles:false}));
   safe(()=>p.addEffect('fire_resistance',30,{amplifier:0,showParticles:false}));
  }
 }
},10);
// V22: Spark Sword charges on successful enemy hits (not teammates).
// On hit five, immobilize the struck enemy with electric sparks for five seconds.
const swordStuns = new Map(); // entity id -> { entity, expiresAtTick }
function sparkStun(target, attacker=null) {
  // V230: chain lightning jumps to up to three more enemies; the target is caged in electricity.
  const d=target.dimension,c={x:target.location.x,y:target.location.y+1,z:target.location.z};
  const awakened=attacker&&held(attacker)===I.awakenedSword;
  F.sfx(d,'sparkmod.sword.chain',c,2.5,1);F.sfx(d,'sparkmod.titan.zap',c,2,.8);
  F.flash(d,c,4,F.C.white);F.cage(d,target,70,F.C.gold);F.shock(d,target.location,3,F.C.gold,.5);
  let from=c,jumped=0;
  for(const e of safe(()=>d.getEntities({location:target.location,maxDistance:8}),[])){
    if(jumped>=3)break;
    if(e.id===target.id||e.id===attacker?.id||!e.getComponent?.('minecraft:health')||e.typeId==='minecraft:item'||e.typeId==='sparkmod:sky_beam'||(attacker&&areTeammates(attacker,e)))continue;
    const to={x:e.location.x,y:e.location.y+1,z:e.location.z},src=from,k=jumped;
    system.runTimeout(()=>{F.bolt(d,src,to,{color:F.C.white,size:.3,branches:1},4);F.sfx(d,'sparkmod.sword.chain',to,1.4,1.2);
      safe(()=>e.applyDamage(awakened?6:4,attacker?{cause:'lightning',damagingEntity:attacker}:undefined));},3+k*3);
    from=to;jumped++;
  }
  const expiresAtTick = system.currentTick + Math.round(3.5 * TICKS);
  swordStuns.set(target.id, { entity: target, expiresAtTick });
  safe(() => target.addEffect('slowness', Math.round(3.5 * TICKS), { amplifier: 255, showParticles: false }));
  safe(() => target.addEffect('weakness', Math.round(3.5 * TICKS), { amplifier: 255, showParticles: false }));
  safe(() => target.dimension.spawnParticle('minecraft:basic_crit_particle', {
    x: target.location.x, y: target.location.y + 1, z: target.location.z
  }));
}
system.runInterval(() => {
  for (const [id, state] of swordStuns) {
    if (system.currentTick >= state.expiresAtTick || !valid(state.entity)) {
      swordStuns.delete(id);
      continue;
    }
    const t = state.entity;
    // Reapply briefly, so any other script clearing effects cannot instantly cancel the stun.
    safe(() => t.addEffect('slowness', 15, { amplifier: 255, showParticles: false }));
    safe(() => t.addEffect('weakness', 15, { amplifier: 255, showParticles: false }));
    const p = t.location;
    // Electric restraint effect at wrists and ankles (vanilla particle approximation).
    for (const offset of [
      [-0.55, 1.25, 0], [0.55, 1.25, 0],
      [-0.25, 0.18, 0], [0.25, 0.18, 0]
    ]) {
      safe(() => t.dimension.spawnParticle('minecraft:basic_crit_particle', {
        x: p.x + offset[0] + (Math.random() - 0.5) * 0.2,
        y: p.y + offset[1], z: p.z + offset[2]
      }));
    }
  }
}, 10);

// V23 weapon combat. No Spark Dog, wolf spawn, or other pet behavior.
// Bedrock does not expose a critical-hit flag or an exact custom mace smash
// implementation. The script samples player descent and approximates both.
const combatAir = new Map(); // player id => { peakY, drop, descending, dim }
const maceSlamTick = new Map();
// V231: a landed downslam starts a 25-second smash cooldown for both normal maces and Spark Maces.
// Regular mace swings continue. The pre-hurt event cancels subsequent native
// maceSmash hits when supported by the Bedrock version in use.
const MACE_SLAM_COOLDOWN_TICKS=25*20;
const maceSlamUntil=new Map();
const maceAllowedSlamTick=new Map();
function maceHeld(player){return equipment(player,EquipmentSlot.Mainhand)?.typeId==='minecraft:mace';}
world.beforeEvents.entityHurt?.subscribe(ev=>{
 const attacker=ev.damageSource?.damagingEntity;
 if(attacker?.typeId!=='minecraft:player' || !maceHeld(attacker))return;
 if(ev.damageSource?.cause!=='maceSmash')return;
 const until=maceSlamUntil.get(attacker.id)||0;
 if(system.currentTick < until){
  ev.cancel=true;
  const left=Math.ceil((until-system.currentTick)/20);
  system.run(()=>safe(()=>attacker.onScreenDisplay.setActionBar(`§c⚡ Downslam recharging: ${left}s`)));
 }
});
// Let the player know when the downslam is ready again.
system.runInterval(()=>{
 for(const [id,until] of maceSlamUntil){
  if(system.currentTick<until)continue;
  maceSlamUntil.delete(id);
  const p=world.getAllPlayers().find(q=>q.id===id);
  if(p){safe(()=>p.onScreenDisplay.setActionBar('§a⚡ Downslam ready!'));safe(()=>p.playSound('random.orb',{volume:.6,pitch:1.6}));}
 }
},10);
world.afterEvents.entityHurt?.subscribe(ev=>{
 const attacker=ev.damageSource?.damagingEntity;
 if(attacker?.typeId!=='minecraft:player'||!maceHeld(attacker))return;
 const air=combatAir.get(attacker.id);
 const slammed=ev.damageSource?.cause==='maceSmash' ||
  (ev.damageSource?.cause==='entityAttack' && air?.descending && air?.drop>=1.5);
 if(!slammed)return;
 if(system.currentTick < (maceSlamUntil.get(attacker.id)||0))return;
 maceSlamUntil.set(attacker.id,system.currentTick+MACE_SLAM_COOLDOWN_TICKS);
 maceAllowedSlamTick.set(attacker.id,system.currentTick);
 safe(()=>attacker.onScreenDisplay.setActionBar('§6⚡ Downslam cooldown: 25 seconds'));
});


function hasSlowFalling(player) { return safe(() => Boolean(player.getEffect('slow_falling')), false); }
function fallingAttack(player) {
  const vel = safe(() => player.getVelocity(), {y:0});
  return safe(() => player.isFalling && !player.isOnGround && !player.isInWater &&
    !player.isClimbing && !hasSlowFalling(player) && vel.y < -0.08, false);
}
// Sample every tick so we can estimate height fallen from the last jump/ledge.
system.runInterval(() => {
  const online = new Set();
  for (const p of world.getAllPlayers()) {
    online.add(p.id);
    const at = p.location, dimensionId = p.dimension.id;
    let state = combatAir.get(p.id);
    if (!state || state.dim !== dimensionId || safe(() => p.isOnGround, true)) {
      combatAir.set(p.id, {peakY: at.y, drop:0, descending:false, dim:dimensionId});
      continue;
    }
    state.peakY = Math.max(state.peakY, at.y);
    state.drop = Math.min(128, Math.max(0, state.peakY-at.y));
    state.descending = fallingAttack(p);
  }
  for (const id of combatAir.keys()) if (!online.has(id)) combatAir.delete(id);
}, 1);
function isSparkCritical(player) {
  const state = combatAir.get(player.id);
  return Boolean(state?.descending && state.drop > 0.12 && fallingAttack(player));
}
function sparkParticles(dimension, pos, amount=12) {
  for(let i=0; i<amount; i++) {
    const a=Math.random()*Math.PI*2, r=0.2+Math.random()*0.8;
    safe(()=>dimension.spawnParticle('minecraft:basic_crit_particle', {
      x:pos.x+Math.cos(a)*r, y:pos.y+0.4+Math.random()*1.6, z:pos.z+Math.sin(a)*r
    }));
  }
}
function maceFx(dim,at,big=false){ // V229: Spark Mace hit effects
  const c={x:at.x,y:at.y+1,z:at.z};
  F.flash(dim,c,big?6:3.5,F.C.gold);F.sparks(dim,c,big?60:28,big?10:7,F.C.gold);
  F.shock(dim,at,big?7:4,F.C.gold,.6);F.debris(dim,at,big?2:1.2,big?36:16);
  F.sfx(dim,'sparkmod.titan.impact',c,big?3:1.8,big?.85:1.2);F.sfx(dim,'sparkmod.titan.zap',c,1.6,1);
  F.shake(dim,c,big?18:10,big?1.1:.5,.4);
}
function strikeCritTarget(attacker, victim) {
  F.bolt(victim.dimension,{x:victim.location.x+(Math.random()-.5)*2,y:victim.location.y+14,z:victim.location.z+(Math.random()-.5)*2},{x:victim.location.x,y:victim.location.y+1,z:victim.location.z},{color:F.C.white,size:.45,branches:2},6);
  maceFx(victim.dimension,victim.location,false);
  const nearTeam = safe(() => attacker.dimension.getPlayers({location:victim.location,maxDistance:4})
      .some(p => p.id!==victim.id && p.id!==attacker.id && areTeammates(attacker,p)), true);
  if (!nearTeam) {
    // Actual lightning can damage nearby entities and set blocks on fire.
    // Briefly protect the melee attacker from their own strike.
    safe(() => attacker.addEffect('resistance', 10, {amplifier:4,showParticles:false}));
    safe(() => attacker.addEffect('fire_resistance', 30, {amplifier:0,showParticles:false}));
    lightning(victim.dimension, victim.location);
  } else {
    // Stay safe if allied players are next to the enemy; still show a lightning-like burst.
    sparkParticles(victim.dimension, victim.location, 28);
    safe(() => victim.applyDamage(4*(1+0.2*forgeTier(equipment(attacker,EquipmentSlot.Mainhand)))));
  }
  safe(()=>victim.dimension.playSound('ambient.weather.thunder', victim.location));
  sparkParticles(victim.dimension, victim.location, 12);
  tell(attacker, '§6⚡ Triple critical chain! Lightning burst!');
}
function maceBonusFromDrop(drop) {
  // Approximate vanilla mace bonus: +4 damage/block for first 3, +2 for next 5, +1 thereafter.
  return 4*Math.min(3,drop) + 2*Math.min(5,Math.max(0,drop-3)) + Math.max(0,drop-8);
}
function maceImpact(attacker, victim, drop) {
  if (maceSlamTick.get(attacker.id) === system.currentTick) return;
  maceSlamTick.set(attacker.id, system.currentTick);
  const extra = Math.floor(maceBonusFromDrop(drop));
  safe(() => victim.applyDamage(extra));
  // Vanilla mace-like blast pushes nearby entities away from the smashed mob.
  for (const entity of safe(()=>victim.dimension.getEntities({location:victim.location,maxDistance:3}), [])) {
    if (entity.id===victim.id || entity.id===attacker.id || areTeammates(attacker,entity)) continue;
    const dx=entity.location.x-victim.location.x, dz=entity.location.z-victim.location.z;
    const dist=Math.hypot(dx,dz);
    if(dist>0.05) safe(()=>entity.applyKnockback({x:dx/dist*1.6,z:dz/dist*1.6},0.3));
  }
  // A short Slow Falling effect after impact is our best-effort fall protection.
  safe(() => attacker.addEffect('slow_falling', 12, {amplifier:0,showParticles:false}));
  sparkParticles(victim.dimension,victim.location,14);
  safe(() => victim.dimension.playSound('mace.smash_ground',victim.location));
  // Preserve Thor Mode's 15-second duration and 5-day cooldown.
  const thor = Date.now() < Number(prop(attacker,'thorUntil',0));
  if (thor) safe(()=>victim.applyDamage(Math.floor((6+extra)*0.5)*(1+0.2*forgeTier(equipment(attacker,EquipmentSlot.Mainhand)))));
  if (drop>=5 && readyQuiet(attacker,'thunderCrashCD')) {
    cooldown(attacker,'thunderCrashCD',30000);
    for (const e of safe(()=>victim.dimension.getEntities({location:victim.location,maxDistance:6}),[])) {
      if(e.id===victim.id || e.id===attacker.id || areTeammates(attacker,e))continue;
      const dX=e.location.x-victim.location.x, dZ=e.location.z-victim.location.z, r=Math.hypot(dX,dZ);
      if(r>0.05) safe(()=>e.applyKnockback({x:1.8*dX/r,z:1.8*dZ/r},0.45));
    }
    sparkParticles(victim.dimension,victim.location,22);
    F.shock(victim.dimension,victim.location,6,F.C.gold,.6);F.sfx(victim.dimension,'sparkmod.titan.slam',victim.location,2,1.2);
  }
  if (thor && drop>=10 && Number(prop(attacker,'judgmentUsedUntil',0)) !== Number(prop(attacker,'thorUntil',0))) {
    setProp(attacker,'judgmentUsedUntil',Number(prop(attacker,'thorUntil',0)));
    // The ultimate deals exactly 10 HP (5 hearts) BONUS damage, not 50 hearts.
    for (const e of safe(()=>victim.dimension.getEntities({location:victim.location,maxDistance:10}),[])) {
      if(e.id===attacker.id || areTeammates(attacker,e))continue;
      safe(()=>e.applyDamage(10*(1+0.2*forgeTier(equipment(attacker,EquipmentSlot.Mainhand)))));
      safe(()=>e.addEffect('weakness',100,{amplifier:0}));
    }
    sparkParticles(victim.dimension,victim.location,40);
    maceFx(victim.dimension,victim.location,true);F.shock(victim.dimension,victim.location,10,F.C.white,1);
    F.sfx(victim.dimension,'sparkmod.titan.explode',victim.location,4,1.3);
    tell(attacker,'§6⚡ Lightning Judgment! +5 hearts bonus damage.');
  }
}
function readyQuiet(player,key) {return Date.now() >= Number(prop(player,key,0));}
// V33: Five critical-like hits on one target, within 7 seconds total,
// and less than 1 second between consecutive critical hits.
const swordCritCombos = new Map(); // attacker ID -> { targetId, count, startedTick, lastTick }
const CRIT_COMBO_TOTAL_TICKS = 20 * TICKS;
const CRIT_COMBO_GAP_TICKS = 3 * TICKS;

system.runInterval(() => {
  for (const [id, state] of swordCritCombos) {
    const player = world.getAllPlayers().find(p => p.id === id);
    if (!player || !(isSparkSword(held(player)) || isSparkMace(player)) ||
        system.currentTick - state.lastTick >= CRIT_COMBO_GAP_TICKS ||
        system.currentTick - state.startedTick > CRIT_COMBO_TOTAL_TICKS) {
      swordCritCombos.delete(id);
    }
  }
}, 10);

world.afterEvents.entityHurt?.subscribe(ev => {
  const attacker=ev.damageSource?.damagingEntity, victim=ev.hurtEntity;
  if (attacker?.typeId!=='minecraft:player' || !valid(victim) || victim.id===attacker.id) return;
  if (ev.damageSource?.cause!=='entityAttack' && ev.damageSource?.cause!=='maceSmash') return;
  if (areTeammates(attacker,victim)) return;
  const weapon=held(attacker);
  if(isSparkSword(weapon) || isSparkMace(attacker)) {
    // The critical flag is approximated from falling movement (Bedrock Script API limitation).
    const tick = system.currentTick;
    const previous = swordCritCombos.get(attacker.id);
    const validContinuation = previous &&
      previous.targetId === victim.id &&
      tick - previous.lastTick < CRIT_COMBO_GAP_TICKS &&
      tick - previous.startedTick <= CRIT_COMBO_TOTAL_TICKS;
    if (!isSparkCritical(attacker)) {
      swordCritCombos.delete(attacker.id);
      safe(()=>attacker.onScreenDisplay.setActionBar('§7⚡ Critical combo reset: normal hit'));
    } else {
      const state = validContinuation
        ? { ...previous, count: previous.count + 1, lastTick: tick }
        : { targetId: victim.id, count: 1, startedTick: tick, lastTick: tick };
      // Lightning strikes the target on hits 3, 6 and 9 of a critical chain.
      if (state.count % 3 === 0) strikeCritTarget(attacker, victim);
      if (state.count >= 10) {
        swordCritCombos.delete(attacker.id);
        if (isSparkSword(weapon)) sparkStun(victim, attacker);
      } else {
        swordCritCombos.set(attacker.id, state);
        safe(()=>attacker.onScreenDisplay.setActionBar(`§e⚡ Critical chain: ${state.count}/10`));
      }
    }
  }
  // V136: three lightning bolts on each confirmed native Spark Mace smash.
  // Keep vanilla smash damage/knockback untouched; lightning is an added effect.
  if (isSparkMace(attacker) && maceAllowedSlamTick.get(attacker.id)===system.currentTick && (ev.damageSource?.cause === 'maceSmash' ||
      (ev.damageSource?.cause === 'entityAttack' &&
       combatAir.get(attacker.id)?.descending &&
       combatAir.get(attacker.id)?.drop >= 1.5))) {
    const previousSlam = maceSlamTick.get(attacker.id) ?? -1000;
    if (system.currentTick - previousSlam > 12) {
      maceSlamTick.set(attacker.id, system.currentTick);
      const dimension = victim.dimension;
      const impact = {...victim.location};
      safe(() => attacker.addEffect('fire_resistance', 70, {amplifier:0,showParticles:false}));
      maceFx(dimension,impact,true);
      F.sfx(dimension,'sparkmod.titan.slam',impact,3,1.1);
      for(let k=0;k<6;k++){const a=k*Math.PI/3;F.arc(dimension,{x:impact.x,y:impact.y+.2,z:impact.z},{x:impact.x+Math.cos(a)*4,y:impact.y+.2,z:impact.z+Math.sin(a)*4},{color:F.C.gold,size:.25,jag:.5,branches:0,max:40});}
      // Spread the three strikes over 0.3 seconds, centered around the enemy.
      for (let i=0; i<3; i++) {
        system.runTimeout(() => {
          const center = safe(() => valid(victim) ? victim.location : impact, impact);
          const angle = (Math.PI * 2 * i / 3);
          const radius = i === 0 ? 0 : 0.65;
          const strike={x:center.x + Math.cos(angle)*radius,y:center.y,z:center.z + Math.sin(angle)*radius};
          lightning(dimension, strike);
          F.bolt(dimension,{x:strike.x,y:strike.y+16,z:strike.z},{x:strike.x,y:strike.y+.5,z:strike.z},{color:F.C.white,size:.5,branches:3},6);
          F.flash(dimension,{x:strike.x,y:strike.y+1,z:strike.z},4,F.C.gold);
        }, i*3+1);
      }
    }
  }
  // Native minecraft:mace handles all smash damage, fall protection and knockback.

});

// V230: every Spark Sword hit cuts an electric slash through the target.
world.afterEvents.entityHurt?.subscribe(ev=>{
  const a=ev.damageSource?.damagingEntity,v=ev.hurtEntity;
  if(a?.typeId!=='minecraft:player'||ev.damageSource?.cause!=='entityAttack'||!valid(v)||v.id===a.id)return;
  const w=held(a);if(!isSparkSword(w)||areTeammates(a,v))return;
  const awakened=w===I.awakenedSword,d=v.dimension,c={x:v.location.x,y:v.location.y+1,z:v.location.z};
  const yaw=safe(()=>a.getRotation().y,0)*Math.PI/180,rx=Math.cos(yaw),rz=Math.sin(yaw);
  F.arc(d,{x:c.x-rx*.9,y:c.y+.8,z:c.z-rz*.9},{x:c.x+rx*.9,y:c.y-.7,z:c.z+rz*.9},{color:awakened?F.C.white:F.C.gold,size:awakened?.3:.22,jag:.25,branches:awakened?2:1,max:40});
  F.sparks(d,c,awakened?26:16,6,F.C.gold);F.orb(d,c,awakened?2.2:1.5,F.C.gold,.15,.8);
  F.sfx(d,'sparkmod.sword.hit',c,1.3,.9+Math.random()*.25);
  if(awakened&&Math.random()<.2){   // awakened: lightning arcs to a second enemy
    const next=safe(()=>d.getEntities({location:v.location,maxDistance:5}),[]).find(e=>e.id!==v.id&&e.id!==a.id&&e.typeId!=='minecraft:item'&&e.typeId!=='sparkmod:sky_beam'&&e.getComponent?.('minecraft:health')&&!areTeammates(a,e));
    if(next){F.bolt(d,c,{x:next.location.x,y:next.location.y+1,z:next.location.z},{color:F.C.white,size:.25,branches:1},4);F.sfx(d,'sparkmod.sword.chain',next.location,1.2,1.3);
      safe(()=>next.applyDamage(3,{cause:'lightning',damagingEntity:a}));}
  }
});
// V230 Lightning Dash: use (right-click) the Spark Sword to dash forward as a bolt of lightning,
// damaging and briefly stunning every enemy along the path.
const lastDashTick=new Map();
function lightningDash(p){
  const w=held(p);if(!isSparkSword(w))return;
  if(system.currentTick-(lastDashTick.get(p.id)??-99)<4)return;   // several triggers can fire for one press
  lastDashTick.set(p.id,system.currentTick);
  const awakened=w===I.awakenedSword,key=awakened?'swordDashCDa':'swordDashCD';
  if(!readyQuiet(p,key)){safe(()=>p.onScreenDisplay.setActionBar(`§7Lightning Dash recharging: ${Math.ceil((Number(prop(p,key,0))-Date.now())/1000)}s`));return;}
  cooldown(p,key,awakened?6000:10000);
  const d=p.dimension,start={...p.location},v=safe(()=>p.getViewDirection(),{x:0,y:0,z:1});
  const l=Math.hypot(v.x,v.z)||1,dir={x:v.x/l,z:v.z/l},range=awakened?9:7;
  let end={...start};
  for(let s=.5;s<=range;s+=.5){
    const q={x:start.x+dir.x*s,y:start.y,z:start.z+dir.z*s};
    const feet=blockAt(d,q),head=blockAt(d,{x:q.x,y:q.y+1,z:q.z});
    if((feet&&!feet.isAir&&!feet.isLiquid)||(head&&!head.isAir&&!head.isLiquid))break;
    end=q;
  }
  const c0={x:start.x,y:start.y+1,z:start.z},c1={x:end.x,y:end.y+1,z:end.z};
  F.sfx(d,'sparkmod.sword.dash',c0,2.5,1);F.flash(d,c0,3,F.C.gold);
  safe(()=>p.teleport(end,{dimension:d,keepVelocity:false}));
  F.bolt(d,c0,c1,{color:F.C.white,size:.4,jag:.4,branches:2},6);
  const len=Math.hypot(end.x-start.x,end.z-start.z);
  for(let s=0;s<=len;s+=.8)F.orb(d,{x:start.x+dir.x*s,y:start.y+1,z:start.z+dir.z*s},1.3,F.C.gold,.35,.8);
  F.flash(d,c1,4,F.C.white);F.shock(d,end,3,F.C.gold,.5);F.sfx(d,'sparkmod.titan.zap',c1,2,1.2);
  let hits=0;
  for(const e of safe(()=>d.getEntities({location:{x:(start.x+end.x)/2,y:start.y,z:(start.z+end.z)/2},maxDistance:len/2+2.5}),[])){
    if(e.id===p.id||e.typeId==='minecraft:item'||e.typeId==='sparkmod:sky_beam'||!e.getComponent?.('minecraft:health')||areTeammates(p,e))continue;
    const t=Math.max(0,Math.min(len,(e.location.x-start.x)*dir.x+(e.location.z-start.z)*dir.z));
    const off=Math.hypot(e.location.x-(start.x+dir.x*t),e.location.z-(start.z+dir.z*t));
    if(off>1.8||Math.abs(e.location.y-start.y)>2.5)continue;
    safe(()=>e.applyDamage(awakened?9:6,{cause:'entityAttack',damagingEntity:p}));
    safe(()=>e.addEffect('slowness',20,{amplifier:255,showParticles:false}));
    F.sparks(d,{x:e.location.x,y:e.location.y+1,z:e.location.z},18,6,F.C.gold);hits++;
  }
  safe(()=>p.onScreenDisplay.setActionBar(`§e⚡ Lightning Dash${hits?` §7- hit ${hits}`:''}`));
}
system.beforeEvents.startup.subscribe(({itemComponentRegistry})=>{
  safe(()=>itemComponentRegistry.registerCustomComponent('sparkmod:sword_dash',{onUse(event){const p=event.source;system.run(()=>lightningDash(p));}}));
});
// V234: three ways to dash, so it works on every device and game version:
//  1. use the sword (right-click / hold the use button),  2. itemUse fallback,
//  3. DOUBLE-TAP SNEAK while holding the Spark Sword.
world.afterEvents.itemUse.subscribe(ev=>{
  const p=ev.source;
  if(p?.typeId==='minecraft:player'&&isSparkSword(ev.itemStack?.typeId))system.run(()=>lightningDash(p));
});
const dashSneak=new Map();
system.runInterval(()=>{
  for(const p of world.getAllPlayers()){
    const s=dashSneak.get(p.id)||{was:false,lastTap:-99};
    const now=p.isSneaking===true;
    if(now&&!s.was&&isSparkSword(held(p))){
      if(system.currentTick-s.lastTap<=8){s.lastTap=-99;lightningDash(p);}
      else s.lastTap=system.currentTick;
    }
    s.was=now;dashSneak.set(p.id,s);
  }
},1);
// V126: particles only on confirmed critical melee impacts; no idle particle loop.
// Critical chain particles are emitted by strikeCritTarget on every third crit.
function awakenedWeaponSparks(p, kind, burst=false) {
 if (!burst) return;
 // Thor Mode activation particles occur only when an enemy is actually hit.
}

function breakNearby(p,kind){const dim=p.dimension,pos=p.location;let n=0;for(let dx=-2;dx<=2;dx++)for(let dy=-1;dy<=2;dy++)for(let dz=-2;dz<=2;dz++){const b=blockAt(dim,{x:pos.x+dx,y:pos.y+dy,z:pos.z+dz});if(!b||b.isAir)continue;const id=b.typeId;const ok=kind==='wood'?/log|wood|planks|stem|hyphae/.test(id):/stone|ore|deepslate|cobblestone|granite|diorite|andesite/.test(id);if(!ok)continue;safe(()=>{dim.runCommand(`setblock ${b.location.x} ${b.location.y} ${b.location.z} air destroy`);n++;});}tell(p,`Lightning mining: ${n} blocks.`);}
world.afterEvents.itemUse.subscribe(ev=>{const p=ev.source,id=ev.itemStack?.typeId;if(p?.typeId!=='minecraft:player'||!id)return;
 if(id===I.tear){triggerSparkToken(p);return;}
 if(id===I.mace && isSparkMace(p)){
   const awakened=awakenedPiece(equipment(p,EquipmentSlot.Mainhand));
   const cdKey=awakened?'awakenedThorCD':'thorCD';
   if(!ready(p,cdKey))return;
   cooldown(p,cdKey,awakened?10*60*1000:30*60*1000);
   setProp(p,'thorUntil',Date.now()+15000);
   // No idle or activation particles; lightning visuals occur on critical hits.
   setProp(p,'thorDefenseUntil',Date.now()+THOR_DEFENSE_MS);
   { // V229: Thor Mode activation burst
     const d=p.dimension,c={x:p.location.x,y:p.location.y+1,z:p.location.z};
     F.sfx(d,'sparkmod.titan.reboot',c,3,1.2);F.sfx(d,'sparkmod.titan.roar',c,2,1.4);
     F.flash(d,c,8,F.C.gold);F.converge(d,c,4,40,F.C.gold);
     for(let k=0;k<4;k++)system.runTimeout(()=>F.pulse(d,c,6+k*4,F.C.gold,.6),k*3);
     F.shock(d,p.location,10,F.C.white,.9);F.shake(d,c,24,1,.8);
   }
   thorLightningStorm(p);
   tell(p,'§6⚡ Thor Storm: 10 lightning strikes targeting enemies within 10 blocks!');
   tell(p,'§e⚡ Thor Mode: 3-minute defensive blink, 15-second damage boost.');
   // Sneak while activating Thor Mode to unleash the awakened teammate force field.
   if(awakened && p.isSneaking){
     const allies=p.dimension.getPlayers({location:p.location,maxDistance:12})
       .filter(q=>q.id!==p.id&&areTeammates(p,q));
     for(const ally of allies){
       setProp(ally,'thorAllyShieldUntil',Date.now()+THOR_ALLY_SHIELD_MS);
       safe(()=>ally.addEffect('resistance',220,{amplifier:4,showParticles:true}));
       tell(ally,'§6⚡ Awakened Thor Force Field: 10 seconds!');
     }
     tell(p,`§6⚡ Awakened Thor Mode shielded ${allies.length} nearby teammates for 10 seconds!`);
   }
   return;
  }

});
// Spark Altar interaction.
world.beforeEvents.playerInteractWithBlock.subscribe(ev=>{if(ev.block?.typeId!==I.altar)return;ev.cancel=true;system.run(()=>altarUI(ev.player));});
// Boss attack loop: only in the End and only if alive; no respawn scheduling.
// Titan attacks: distinct cooldowns per entity, player-targeted, with phase-2 escalation.



// V163: each Spark armor piece gives its own effect across standard and V3 versions.
// Health Boost X provides 40 bonus max-health points (20 hearts).
// Weaving is a vanilla effect that releases cobwebs on death; it does not
// continuously produce webs while walking.
system.runInterval(()=>{for(const p of world.getAllPlayers()){
 const helmet=equipment(p,EquipmentSlot.Head)?.typeId;
 const chest=equipment(p,EquipmentSlot.Chest)?.typeId;
 const legs=equipment(p,EquipmentSlot.Legs)?.typeId;
 const boots=equipment(p,EquipmentSlot.Feet)?.typeId;
 // V229 armour effects (awakened = awakened at the Spark Shrine; V3 forging no longer changes them).
 const isAwake=slot=>{const it=equipment(p,slot);return safe(()=>it?.getDynamicProperty('sparkmod:awakened')===true,false)||!!it?.getLore?.().some(l=>/awaken/i.test(l));};
 if([I.helmet,I.helmetV3].includes(helmet))safe(()=>p.addEffect('weaving',55,{amplifier:0,showParticles:false}));          // Weaving I
 // Health Boost adds hearts in steps of 2: level 8 = +16 hearts (closest to 15), level 10 = +20 hearts.
 if([I.chest,I.chestV3].includes(chest))safe(()=>p.addEffect('health_boost',55,{amplifier:isAwake(EquipmentSlot.Chest)?9:7,showParticles:false}));
 if([I.legs,I.legsV3].includes(legs))safe(()=>p.addEffect('resistance',55,{amplifier:isAwake(EquipmentSlot.Legs)?1:0,showParticles:false}));  // Resistance I / II
 if([I.boots,I.bootsV3].includes(boots))safe(()=>p.addEffect('speed',55,{amplifier:isAwake(EquipmentSlot.Feet)?2:0,showParticles:false}));      // Speed I / III
 // Keep the existing Spark Sword full-set Strength I synergy.
 if(hasFullSet(p)&&isSparkSword(held(p)))safe(()=>p.addEffect('strength',55,{amplifier:0,showParticles:false}));
}},20);
function sparkLocate(p){
 if(![I.helmet,I.helmetV3].includes(equipment(p,EquipmentSlot.Head)?.typeId)){tell(p,'Equip the Spark Helmet first.');return;}
 const moon=sparkMoonStatus();if(!moon.active){tell(p,'Player tracking works only during a Spark Moon.');return;}
 if(Number(prop(p,'helmetTrackMoon',-1))===moon.moonId){tell(p,'Already used helmet tracking this Spark Moon.');return;}
 const options=world.getAllPlayers().filter(q=>q.id!==p.id&&!areTeammates(p,q));
 if(!options.length){tell(p,'No eligible online players to locate.');return;}
 const q=options[Math.floor(Math.random()*options.length)];setProp(p,'helmetTrackMoon',moon.moonId);
 tell(p,`§eSpark sight: ${q.name} at ${Math.floor(q.location.x)}, ${Math.floor(q.location.y)}, ${Math.floor(q.location.z)} (${q.dimension.id}).`);
}
// Chat admin commands; use only in a copied world. !sparkbuild changes blocks.
// V152: Chat triggers are only available when the server exposes chatSend.
// The Teammate Compass below is a reliable UI fallback on Realms and mobile.
function handleSparkChat(p,raw){
 const cmd=String(raw).trim().toLowerCase();
 if(cmd==='!teammate'){system.runTimeout(()=>openTeammateForm(p),2);return true;}
 if(cmd==='!accept'){system.run(()=>replyToTeamRequest(p,true));return true;}
 if(cmd==='!deny'){system.run(()=>replyToTeamRequest(p,false));return true;}
 if(cmd==='!sparktoken'||cmd==='!sparkmenu'){system.run(()=>{if(count(p,I.tear)<1){tell(p,'You need a Spark Token in your inventory.');return;}triggerSparkToken(p);});return true;}
 if(cmd==='!sparkteam'){system.run(()=>tell(p,'Use !teammate or your Teammate Compass to open the invite UI.'));return true;}
 if(cmd==='!sparklocate'){system.run(()=>sparkLocate(p));return true;}
 if(cmd==='!sparkmoon'){system.run(()=>{const moon=sparkMoonStatus();tell(p,moon.active?`Spark Moon ACTIVE! Ends in ${formatMoonTime(moon.remainingMs)}.`:`Next Spark Moon in ${formatMoonTime(moon.remainingMs)}.`);});return true;}
 if(cmd==='!sparkhelp'){system.run(()=>tell(p,'Commands: !teammate, !accept, !deny. If chat commands do not work, use your Teammate Compass.'));return true;}
 return false;
}
try{
 const chat=world.beforeEvents.chatSend;
 if(chat && typeof chat.subscribe==='function')chat.subscribe(ev=>{
   const cmd=String(ev.message).trim().toLowerCase();
   if(Number(safe(()=>ev.sender.getDynamicProperty('sparkmod:locator_map_lock_until'),0)||0)>Date.now()){ev.cancel=true;return;}
   if(!['!teammate','!accept','!deny','!sparktoken','!sparkmenu','!sparkteam','!sparklocate','!sparkmoon','!sparkhelp'].includes(cmd))return;
   ev.cancel=true;
   handleSparkChat(ev.sender,cmd);
 });
 else console.warn('[SparkMod] chatSend is unavailable; use Teammate Compass.');
}catch(e){console.warn('[SparkMod] chat listener unavailable: '+String(e));}
// Guaranteed alternative to chat commands: /scriptevent sparkmod:teammate,
// /scriptevent sparkmod:accept and /scriptevent sparkmod:deny.
system.afterEvents.scriptEventReceive.subscribe(ev=>{
 const p=ev.sourceEntity;
 if(p?.typeId!=='minecraft:player')return;
 if(ev.id==='sparkmod:accept')system.run(()=>replyToTeamRequest(p,true));
 if(ev.id==='sparkmod:deny')system.run(()=>replyToTeamRequest(p,false));
});
// Compass menu: supports inviting, accepting and denying even if chat hooks are blocked.
function teammateHub(p){
 new ActionFormData().title('§6⚡ Spark Teams').body('Invite an online player or respond to a pending request. Max 5 teammates; no friendly fire.')
 .button('Invite Player').button('Accept Request').button('Deny Request').button('Close')
 .show(p).then(r=>{
  if(r.canceled)return;
  if(r.selection===0)system.runTimeout(()=>openTeammateForm(p),2);
  if(r.selection===1)replyToTeamRequest(p,true);
  if(r.selection===2)replyToTeamRequest(p,false);
 }).catch(e=>tell(p,'§cTeam menu could not open: '+String(e)));
}
system.beforeEvents.startup.subscribe(({itemComponentRegistry})=>{
 itemComponentRegistry.registerCustomComponent('sparkmod:teammate_menu_use',{
  onUse(ev){const p=ev.source;if(p?.typeId==='minecraft:player')system.run(()=>teammateHub(p));}
 });
});
world.afterEvents.itemUse.subscribe(ev=>{
 if(ev.source?.typeId==='minecraft:player'&&ev.itemStack?.typeId==='sparkmod:teammate_compass')
   system.run(()=>teammateHub(ev.source));
});
const givenCompass=new Set();
system.runInterval(()=>{
 for(const p of world.getAllPlayers()){
  if(givenCompass.has(p.id))continue;
  const inv=bag(p);if(!inv)continue;
  givenCompass.add(p.id);
  if(!count(p,'sparkmod:teammate_compass')){
   try{inv.addItem(new ItemStack('sparkmod:teammate_compass',1));tell(p,'§6⚡ Teammate Compass added! Use it to invite, accept or deny team requests.');}
   catch(e){console.warn('[SparkMod] Could not give compass: '+String(e));}
  }
 }
},100);
system.runTimeout(()=>{sparkMoonStart();startWorld();},200);
// Announces moon transitions to online players without repeated notifications.
let lastMoonActive = null;
system.runInterval(()=>{const status=sparkMoonStatus();if(lastMoonActive!==null && status.active!==lastMoonActive){/* V111: Spark Moon chat announcements disabled. */}lastMoonActive=status.active;},20*30);


// V150: PvP kill rewards. A Spark Moon kill grants two tokens immediately;
// otherwise each third player kill grants one. Progress persists per player.
world.afterEvents.entityDie.subscribe(ev=>{
 const victim=ev.deadEntity;
 if(victim?.typeId!=='minecraft:player')return;
 const killer=ev.damageSource?.damagingEntity;
 if(killer?.typeId!=='minecraft:player'||killer.id===victim.id)return;
 // Friendly fire and teammate kills must never generate Spark Tokens.
 if(areTeammates(killer,victim))return;
 const moon=sparkMoonStatus();
 if(moon.active){
  give(killer,I.tear,2);
  safe(()=>killer.sendMessage('§e⚡ Spark Moon PvP kill! +2 Spark Tokens.'));
  return;
 }
 const progress=Number(prop(killer,'pvpTokenKillProgress',0))+1;
 if(progress>=3){
  setProp(killer,'pvpTokenKillProgress',0);
  give(killer,I.tear,1);
  safe(()=>killer.sendMessage('§6⚡ 3 PvP kills! +1 Spark Token.'));
 }else{
  setProp(killer,'pvpTokenKillProgress',progress);
  safe(()=>killer.sendMessage(`§7Spark Token progress: ${progress}/3 PvP kills.`));
 }
});

// V237: God Villagers glitter so they're easy to find.
system.runInterval(()=>{
  for(const p of world.getAllPlayers())for(const v of safe(()=>p.dimension.getEntities({type:'sparkmod:god_villager',location:p.location,maxDistance:48}),[])){
    F.motes(v.dimension,{x:v.location.x,y:v.location.y+1.2,z:v.location.z},.5,4,F.C.gold);
    F.orb(v.dimension,{x:v.location.x,y:v.location.y+2.3,z:v.location.z},.8,F.C.gold,1.1,.5);
  }
},20);
// V238: Spark Bow hooks into the shrine economy, teams and Spark Moon awakening rules.
initSparkBow({
  isAlly:(a,b)=>areTeammates(a,b),
  take:(p,n)=>take(p,I.tear,n),
  count:p=>count(p,I.tear),
  moon:()=>sparkMoonStatus(),
  moonUsed:()=>false,   // V239: no awakening limit
  onAwaken:p=>shrineMoonBeam(p),
  setMoonUsed:(p,m)=>setProp(p,'lastAwakeningMoon',m.moonId)
});
// V236: tell every player where the Spark Colosseum and Spark Shrine are when they join.
world.afterEvents.playerSpawn.subscribe(({player,initialSpawn})=>{
  if(!initialSpawn)return;
  system.runTimeout(()=>{
    if(!valid(player))return;
    const cy=world.getDynamicProperty('sparkmod:colosseum_sparks_v182_y');
    const sy=world.getDynamicProperty('sparkmod:temple_surface_y');
    tell(player,'§6§l⚡ SPARK LOCATIONS LEAKED ⚡');
    // V244: the real positions (moved to plains if the classic spot was ocean/river).
    const co=siteOf('colosseum'),sh=siteOf('shrine');
    tell(player,`§eSpark Colosseum: §fX ${co.x}, ${typeof cy==='number'?'Y '+(cy+4)+', ':''}Z ${co.z} §7(summon the Bolt Titan with 1 diamond)${co.moved?' §8- moved off the water to plains':''}`);
    tell(player,`§eSpark Shrine: §fX ${sh.x}, ${typeof sy==='number'?'Y '+sy+', ':''}Z ${sh.z} §7(awaken, forge and recharge your Spark gear)${sh.moved?' §8- moved off the water to plains':''}`);
  },100);
});
// V8: instant-mining action on USE-ON-BLOCK with the appropriate tool.
// This is a Bedrock-friendly interaction alternative to left-click instant breaking.
const PROTECTED_BLOCKS = /bedrock|barrier|command_block|structure_block|jigsaw|end_portal|nether_portal|end_gateway|reinforced_deepslate/;
const TOOL_WOOD = /_log|_wood|_planks|_stem|_hyphae|bamboo_block/;
const TOOL_MINE = /stone|deepslate|ore|obsidian|netherrack|basalt|tuff|granite|diorite|andesite|sandstone|terracotta/;
world.beforeEvents.itemUseOn?.subscribe(ev=>{
 const p=ev.source,b=ev.block,id=ev.itemStack?.typeId;
 if(p?.typeId!=='minecraft:player'||!b||!id)return;
 if(id!=='sparkmod:disabled_axe')return;
 const type=b.typeId;
 if(PROTECTED_BLOCKS.test(type))return;
 if(!TOOL_WOOD.test(type))return;
 // Run after the before-event read-only phase.
 const loc={...b.location},dimension=p.dimension;
 system.run(()=>{
   if(!valid(p))return;
   const current=blockAt(dimension,loc);
   if(!current||current.typeId!==type)return;
   safe(()=>dimension.runCommand(`setblock ${loc.x} ${loc.y} ${loc.z} air destroy`));
 });
});

// Release transient player state on disconnect. Persistent rewards stay saved.
world.afterEvents.playerLeave.subscribe(({playerId})=>{
 for(const state of [gachaActive,menuActive,sparkTokenUseTimes,tokenSneakPrevious,thorBlinkTicks,combatAir,maceSlamTick,swordCritCombos,givenCompass])state.delete(playerId);
});
