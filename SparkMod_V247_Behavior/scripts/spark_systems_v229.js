import * as MC from '@minecraft/server';
const {world,system,EquipmentSlot}=MC;
// Read through the namespace so an older game build can't fail to load the whole pack.
const PERM=MC.CommandPermissionLevel?.GameDirectors??1,OK=MC.CustomCommandStatus?.Success??0,FAIL=MC.CustomCommandStatus?.Failure??1;
import {ModalFormData} from '@minecraft/server-ui';
import {getConfig,setConfig,DEFAULTS} from './spark_config.js';
import * as F from './titan_fx_v217.js';

// SparkMod V229
//  1. /deck3 - operator settings deck (locator maps, bundles, mace limits).
//  2. God armour is one-of-a-kind: only the copy issued by a Spark roll may exist. Creative and
//     command copies are deleted. If the real piece is destroyed or falls into the void, its roll
//     slot is released so it can be rolled again.
//  3. Spark Chestplate: a lethal hit triggers SPARK MODE instead of death (lightning on everyone
//     nearby, immortal 10 s, Speed IV + Strength II). Afterwards the wearer is DRAINED (-2 damage
//     on every hit, half speed) until recharged at the Spark Shrine for 3 Spark Tokens.
const safe=(fn,f)=>{try{return fn();}catch(e){return f;}};
const DIMS=['overworld','nether','the_end'];
const tell=(p,m)=>safe(()=>p.sendMessage(m));

// ============================================================ 1. /deck3
async function openDeck(p){
 const c=getConfig();
 const form=new ModalFormData().title('§6⚡ SparkMod Deck')
  .toggle('Clear locator maps instantly',{defaultValue:c.clearLocatorMaps})
  .toggle('Clear bundles instantly',{defaultValue:c.clearBundles})
  .slider('Ordinary mace limit (whole world)',0,20,{defaultValue:c.maceLimit,valueStep:1})
  .slider('Spark Mace limit (whole world)',0,10,{defaultValue:c.sparkMaceLimit,valueStep:1});
 let r;
 for(let attempt=0;attempt<4;attempt++){
  r=await safe(()=>form.show(p),null);
  if(!r||!r.canceled||r.cancelationReason!=='UserBusy')break;
  await new Promise(res=>system.runTimeout(res,10));
 }
 if(!r||r.canceled||!r.formValues)return;
 const [maps,bundles,maces,spark]=r.formValues;
 const next=setConfig({clearLocatorMaps:!!maps,clearBundles:!!bundles,maceLimit:Math.round(Number(maces)),sparkMaceLimit:Math.round(Number(spark))});
 tell(p,`§6⚡ SparkMod settings saved: §eLocator maps ${next.clearLocatorMaps?'§ccleared':'§aallowed'}§e, bundles ${next.clearBundles?'§ccleared':'§aallowed'}§e, mace limit §f${next.maceLimit}§e, Spark Mace limit §f${next.sparkMaceLimit}§e.`);
}
system.beforeEvents.startup?.subscribe(({customCommandRegistry})=>{
 safe(()=>customCommandRegistry.registerCommand({
  name:'sparkmod:deck3',
  description:'Open the SparkMod settings deck (locator maps, bundles, mace limits)',
  permissionLevel:PERM,
  cheatsRequired:false
 },origin=>{
  const p=origin.sourceEntity;
  if(p?.typeId!=='minecraft:player')return {status:FAIL,message:'Only a player can open the deck.'};
  system.run(()=>openDeck(p));
  return {status:OK};
 }));
});
// Fallback for older builds: /scriptevent sparkmod:deck3 (operators only).
system.afterEvents.scriptEventReceive.subscribe(ev=>{
 if(ev.id!=='sparkmod:deck3')return;
 const p=ev.sourceEntity;
 if(p?.typeId!=='minecraft:player')return;
 if(safe(()=>p.playerPermissionLevel,2)<2){tell(p,'§cOnly operators can change SparkMod settings.');return;}
 system.run(()=>openDeck(p));
});

// ============================================================ 2. one-of-a-kind god armour
const ARMOR={helmet:['sparkmod:god_helmet','sparkmod:god_helmet_v3'],chestplate:['sparkmod:god_chestplate','sparkmod:god_chestplate_v3'],
             leggings:['sparkmod:god_leggings','sparkmod:god_leggings_v3'],boots:['sparkmod:god_boots','sparkmod:god_boots_v3']};
const NAME={helmet:'Helmet',chestplate:'Chestplate',leggings:'Leggings',boots:'Boots'};
const slotOf=id=>Object.keys(ARMOR).find(k=>ARMOR[k].includes(id));
const SERIAL='sparkmod:god_serial',REG='sparkmod:god_registry',CLAIMS='sparkmod:uniqueSparkRolls';
const readReg=()=>safe(()=>JSON.parse(world.getDynamicProperty(REG)||'{}'),{})||{};
const writeReg=r=>safe(()=>world.setDynamicProperty(REG,JSON.stringify(r)));
const claims=()=>String(safe(()=>world.getDynamicProperty(CLAIMS),'')||'').split('|').filter(Boolean);
let counter=0;

// Called by the roll code right after a god armour piece is handed out.
export function issueGodArmor(player,id){
 const slot=slotOf(id);if(!slot)return;
 const r=readReg();
 r[slot]={serial:null,pending:{player:player.id,until:Date.now()+120000}};
 writeReg(r);
}
function release(slot,why){
 const r=readReg();delete r[slot];writeReg(r);
 const base=ARMOR[slot][0];
 safe(()=>world.setDynamicProperty(CLAIMS,claims().filter(x=>x!==base).join('|')));
 for(const [s,info] of serialInfo)if(info.slot===slot)serialInfo.delete(s);
 world.sendMessage(`§6⚡ The God ${NAME[slot]} was ${why}. It can be rolled again!`);
}
// Decide what to do with one god armour stack. Returns 'keep' | 'stamped' | 'remove' | null.
function judge(stack,pass,where){
 const slot=slotOf(stack?.typeId);if(!slot)return null;
 const r=pass.reg;const entry=r[slot];
 const serial=safe(()=>stack.getDynamicProperty(SERIAL));
 if(serial){
  if(entry?.serial!==serial||pass.seen.has(serial))return 'remove';   // stale or duplicated copy
  pass.seen.add(serial);
  const info=serialInfo.get(serial)||{slot};
  info.lastSeen=Date.now();
  if(where.player){info.player=where.player;info.dur=durability(stack);}
  serialInfo.set(serial,info);
  return 'keep';
 }
 // Unstamped: only the piece a roll just handed out (or a pre-V229 rolled piece) is real.
 const pending=entry?.pending&&entry.pending.until>Date.now();
 const legacy=!entry&&claims().includes(ARMOR[slot][0]);
 if(!pending&&!legacy)return 'remove';
 const s=slot+'_'+Date.now().toString(36)+'_'+(++counter);
 if(!safe(()=>{stack.setDynamicProperty(SERIAL,s);return true;},false))return 'keep';
 r[slot]={serial:s};pass.dirty=true;pass.seen.add(s);
 serialInfo.set(s,{slot,lastSeen:Date.now(),player:where.player,dur:durability(stack)});
 return 'stamped';
}
function durability(stack){
 const d=safe(()=>stack.getComponent('minecraft:durability'));
 return d&&d.maxDurability>0?d.damage/d.maxDurability:0;
}
const serialInfo=new Map(); // serial -> {slot, lastSeen, player, dur, missing}
function scanContainer(container,pass,where,owner){
 const size=safe(()=>container?.size,0);
 for(let i=0;i<size;i++){
  const stack=safe(()=>container.getItem(i));if(!stack)continue;
  const v=judge(stack,pass,where);
  if(v==='remove'){safe(()=>container.setItem(i,undefined));if(owner)tell(owner,'§cGod armour only comes from Spark rolls, and only one of each can exist. This copy was removed.');}
  else if(v==='stamped')safe(()=>container.setItem(i,stack));
 }
}
const EQUIP=[EquipmentSlot.Head,EquipmentSlot.Chest,EquipmentSlot.Legs,EquipmentSlot.Feet,EquipmentSlot.Mainhand,EquipmentSlot.Offhand];
function scanPlayer(p,pass){
 const where={player:p.id};
 scanContainer(safe(()=>p.getComponent('minecraft:inventory')?.container),pass,where,p);
 const eq=safe(()=>p.getComponent('minecraft:equippable'));
 if(eq)for(const s of EQUIP){
  const stack=safe(()=>eq.getEquipment(s));if(!stack)continue;
  const v=judge(stack,pass,where);
  if(v==='remove'){safe(()=>eq.setEquipment(s,undefined));tell(p,'§cGod armour only comes from Spark rolls, and only one of each can exist. This copy was removed.');}
  else if(v==='stamped')safe(()=>eq.setEquipment(s,stack));
 }
 const cursor=safe(()=>p.getComponent('minecraft:cursor_inventory'));
 const held=safe(()=>cursor?.item);
 if(held){const v=judge(held,pass,where);if(v==='remove')safe(()=>cursor.clear());}
}
const newPass=()=>({reg:readReg(),seen:new Set(),dirty:false});
// Players: fast, so creative/command copies vanish almost instantly.
system.runInterval(()=>{
 const pass=newPass();
 const online=new Set();
 for(const p of world.getAllPlayers()){online.add(p.id);scanPlayer(p,pass);}
 if(pass.dirty)writeReg(pass.reg);
 // A piece that vanished from an online holder while nearly broken has broken.
 const now=Date.now();
 for(const [serial,info] of serialInfo){
  if(pass.seen.has(serial)||!info.player||!online.has(info.player))continue;
  if(now-info.lastSeen<300)continue;
  if((info.dur??0)>=.85){
   info.missing=(info.missing||0)+1;
   const holder=world.getAllPlayers().find(q=>q.id===info.player);
   if(info.missing>=3&&!itemEntitySerials.has(serial)&&holder&&!stillExists(serial,holder.dimension,holder.location,6))release(info.slot,'broken');
  }
 }
},5);
// Dropped items: void detection + destroyed-on-the-ground detection.
const MIN_Y={'minecraft:overworld':-64,'minecraft:nether':0,'minecraft:the_end':0};
const itemEntities=new Map();      // entity id -> {serial, slot, dim, loc}
const itemEntitySerials=new Set();
system.runInterval(()=>{
 const pass=newPass();
 itemEntitySerials.clear();
 for(const name of DIMS){
  const dim=safe(()=>world.getDimension(name));if(!dim)continue;
  for(const e of safe(()=>dim.getEntities({type:'minecraft:item'}),[])){
   const stack=safe(()=>e.getComponent('minecraft:item')?.itemStack);
   if(!slotOf(stack?.typeId))continue;
   const v=judge(stack,pass,{});
   if(v==='remove'){safe(()=>e.remove());continue;}
   if(v==='stamped'){const at={...e.location};safe(()=>e.remove());safe(()=>dim.spawnItem(stack,at));continue;}
   const serial=safe(()=>stack.getDynamicProperty(SERIAL));
   itemEntitySerials.add(serial);
   if(e.location.y<(MIN_Y[dim.id]??-64)-6){        // falling through the void
    itemEntities.delete(e.id);safe(()=>e.remove());release(slotOf(stack.typeId),'lost to the void');continue;
   }
   itemEntities.set(e.id,{serial,slot:slotOf(stack.typeId),dim:dim.id,loc:{...e.location}});
  }
 }
 if(pass.dirty)writeReg(pass.reg);
},4);
// Containers near players (creative copies stashed in chests are removed too).
system.runInterval(()=>{
 const pass=newPass();
 for(const p of world.getAllPlayers()){
  const d=p.dimension,c=p.location;
  for(let x=-5;x<=5;x++)for(let y=-2;y<=2;y++)for(let z=-5;z<=5;z++){
   const b=safe(()=>d.getBlock({x:Math.floor(c.x)+x,y:Math.floor(c.y)+y,z:Math.floor(c.z)+z}));
   const inv=b&&safe(()=>b.getComponent('minecraft:inventory')?.container);
   if(inv)scanContainer(inv,pass,{},null);
  }
  for(const e of safe(()=>d.getEntities({location:c,maxDistance:16}),[]))
   if(e.typeId!=='minecraft:player'&&e.typeId!=='minecraft:item')scanContainer(safe(()=>e.getComponent('minecraft:inventory')?.container),pass,{},null);
 }
 if(pass.dirty)writeReg(pass.reg);
},40);
// A tracked dropped piece disappeared: picked up, hoppered, or destroyed (lava, fire, cactus, despawn)?
world.afterEvents.entityRemove?.subscribe(({removedEntityId})=>{
 const rec=itemEntities.get(removedEntityId);if(!rec)return;
 itemEntities.delete(removedEntityId);
 system.runTimeout(()=>safe(()=>{
  const dim=world.getDimension(rec.dim);
  if(!safe(()=>dim.getBlock({x:Math.floor(rec.loc.x),y:Math.floor(rec.loc.y),z:Math.floor(rec.loc.z)}),undefined))return; // chunk unloaded, not destroyed
  if(stillExists(rec.serial,dim,rec.loc))return;
  release(rec.slot,'destroyed');
 }),3);
});
function hasSerial(container,serial){
 const size=safe(()=>container?.size,0);
 for(let i=0;i<size;i++)if(safe(()=>container.getItem(i)?.getDynamicProperty(SERIAL))===serial)return true;
 return false;
}
function stillExists(serial,dim,loc,reach=2){
 for(const p of world.getAllPlayers()){
  if(hasSerial(safe(()=>p.getComponent('minecraft:inventory')?.container),serial))return true;
  const eq=safe(()=>p.getComponent('minecraft:equippable'));
  if(eq&&EQUIP.some(s=>safe(()=>eq.getEquipment(s)?.getDynamicProperty(SERIAL))===serial))return true;
  if(safe(()=>p.getComponent('minecraft:cursor_inventory')?.item?.getDynamicProperty(SERIAL))===serial)return true;
 }
 for(const e of safe(()=>dim.getEntities({location:loc,maxDistance:6}),[])){
  if(e.typeId==='minecraft:item'&&safe(()=>e.getComponent('minecraft:item')?.itemStack?.getDynamicProperty(SERIAL))===serial)return true;
  if(hasSerial(safe(()=>e.getComponent('minecraft:inventory')?.container),serial))return true;
 }
 for(let x=-reach;x<=reach;x++)for(let y=-3;y<=2;y++)for(let z=-reach;z<=reach;z++){
  const b=safe(()=>dim.getBlock({x:Math.floor(loc.x)+x,y:Math.floor(loc.y)+y,z:Math.floor(loc.z)+z}));
  if(b&&hasSerial(safe(()=>b.getComponent('minecraft:inventory')?.container),serial))return true;
 }
 return false;
}

// ============================================================ 3. Spark Chestplate
const SPARK_UNTIL='sparkmod:spark_mode_until',USED='sparkmod:spark_chest_used',DRAINED='sparkmod:spark_drained';
const SPARK_MS=10000;
// V234: Spark Mode (10 s of immortality) is unlocked by AWAKENING the Spark Chestplate.
const chestItem=p=>safe(()=>p.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Chest));
const wearingSparkChest=p=>{
 const it=chestItem(p);
 if(!ARMOR.chestplate.includes(it?.typeId))return false;
 return safe(()=>it.getDynamicProperty('sparkmod:awakened')===true,false)||!!safe(()=>it.getLore?.().some(l=>/awaken/i.test(l)),false);
};
const inSparkMode=p=>Number(safe(()=>p.getDynamicProperty(SPARK_UNTIL),0)||0)>Date.now();
const drained=p=>safe(()=>p.getDynamicProperty(DRAINED),false)===true;
const charged=p=>safe(()=>p.getDynamicProperty(USED),false)!==true;

world.beforeEvents.entityHurt.subscribe(ev=>{
 const victim=ev.hurtEntity,attacker=ev.damageSource?.damagingEntity;
 // Drained players deal 2 less damage with everything.
 if(attacker?.typeId==='minecraft:player'&&drained(attacker)){
  ev.damage=Math.max(0,ev.damage-2);
  if(ev.damage<=0){ev.cancel=true;return;}
 }
 if(victim?.typeId!=='minecraft:player')return;
 if(inSparkMode(victim)){ev.cancel=true;return;}
 const h=victim.getComponent('minecraft:health');if(!h)return;
 if(ev.damage<h.currentValue)return;                     // not lethal
 if(!wearingSparkChest(victim)||!charged(victim))return;
 ev.cancel=true;                                          // death prevented: SPARK MODE
 const id=victim.id;
 system.run(()=>{const p=world.getAllPlayers().find(q=>q.id===id);if(p)startSparkMode(p);});
});
function startSparkMode(p){
 if(inSparkMode(p))return;
 safe(()=>p.setDynamicProperty(SPARK_UNTIL,Date.now()+SPARK_MS));
 safe(()=>p.setDynamicProperty(USED,true));
 const h=p.getComponent('minecraft:health');safe(()=>h.setCurrentValue(h.effectiveMax));
 safe(()=>p.addEffect('speed',SPARK_MS/50,{amplifier:3,showParticles:false}));      // Speed IV
 safe(()=>p.addEffect('strength',SPARK_MS/50,{amplifier:1,showParticles:false}));   // Strength II
 safe(()=>p.addEffect('fire_resistance',SPARK_MS/50+40,{amplifier:0,showParticles:false}));
 const d=p.dimension,c={x:p.location.x,y:p.location.y+1,z:p.location.z};
 F.flash(d,c,10,F.C.white);F.flash(d,c,6,F.C.gold);F.shock(d,p.location,14,F.C.gold,1);
 F.sparks(d,c,80,12,F.C.gold);F.sfx(d,'sparkmod.titan.godmode',c,6,1.2);F.sfx(d,'sparkmod.titan.explode',c,4,1.4);
 F.shake(d,c,32,1.6,1);
 // Lightning strikes everyone nearby.
 let n=0;
 for(const e of safe(()=>d.getEntities({location:p.location,maxDistance:24}),[])){
  if(e.id===p.id||e.typeId==='minecraft:item'||e.typeId==='minecraft:xp_orb'||e.typeId==='minecraft:lightning_bolt'||e.typeId==='sparkmod:sky_beam')continue;
  if(!safe(()=>e.getComponent('minecraft:health'),null))continue;
  const at={...e.location},delay=2+(n++%10)*2;
  system.runTimeout(()=>{
   safe(()=>d.spawnEntity('minecraft:lightning_bolt',at));
   F.bolt(d,c,{x:at.x,y:at.y+1,z:at.z},{color:F.C.gold,size:.35,branches:2},4);
  },delay);
 }
 safe(()=>p.onScreenDisplay.setTitle('§6§l⚡ SPARK MODE ⚡',{subtitle:'§eImmortal for 10 seconds!',fadeInDuration:3,stayDuration:40,fadeOutDuration:10}));
 for(const q of safe(()=>d.getPlayers({location:p.location,maxDistance:64}),[]))if(q.id!==p.id)tell(q,`§6⚡ ${p.name}'s Spark Chestplate refused to let them die!`);
}
system.runInterval(()=>{
 for(const p of world.getAllPlayers()){
  const until=Number(safe(()=>p.getDynamicProperty(SPARK_UNTIL),0)||0);
  if(until){
   if(Date.now()<until){
    const d=p.dimension,c={x:p.location.x,y:p.location.y+1,z:p.location.z};
    F.motes(d,c,.6,6,F.C.gold);F.orb(d,c,2.2,F.C.gold,.25,.5);
    F.arc(d,{x:c.x+(Math.random()-.5)*1.4,y:c.y+.9,z:c.z+(Math.random()-.5)*1.4},{x:c.x+(Math.random()-.5)*1.4,y:c.y-.9,z:c.z+(Math.random()-.5)*1.4},{color:F.C.white,size:.15,branches:0,max:20});
    safe(()=>p.onScreenDisplay.setActionBar(`§6§l⚡ SPARK MODE §r§e${Math.ceil((until-Date.now())/1000)}s`));
    continue;
   }
   // Spark Mode is over: drained until recharged at the Spark Shrine.
   safe(()=>p.setDynamicProperty(SPARK_UNTIL,undefined));
   safe(()=>p.setDynamicProperty(DRAINED,true));
   safe(()=>p.removeEffect('speed'));safe(()=>p.removeEffect('strength'));
   F.sfx(p.dimension,'sparkmod.titan.shutdown',p.location,2,1.2);F.smoke(p.dimension,{x:p.location.x,y:p.location.y+1,z:p.location.z},8,.6);
   safe(()=>p.onScreenDisplay.setTitle('§c§lSPARK MODE ENDED',{subtitle:'§7Drained: -2 damage, half speed. Recharge at the Spark Shrine (3 Spark Tokens).',fadeInDuration:5,stayDuration:80,fadeOutDuration:20}));
  }
  if(drained(p))safe(()=>p.addEffect('slowness',40,{amplifier:2,showParticles:false}));   // about half speed
 }
},10);
// Spark Shrine (the Spark Altar) recharge. pay() must take 3 Spark Tokens and return true.
export function sparkChestStatus(p){return inSparkMode(p)?'active':charged(p)?'charged':'used';}
export function sparkChestAwakened(p){return wearingSparkChest(p);}
export function rechargeSparkChest(p,pay){
 if(charged(p)&&!drained(p)){tell(p,'§eYour Spark Chestplate is already charged.');return;}
 if(inSparkMode(p)){tell(p,'§eWait for Spark Mode to end first.');return;}
 if(!pay()){tell(p,'§cYou need 3 Spark Tokens to recharge.');return;}
 safe(()=>p.setDynamicProperty(USED,undefined));
 safe(()=>p.setDynamicProperty(DRAINED,undefined));
 safe(()=>p.removeEffect('slowness'));
 const d=p.dimension,c={x:p.location.x,y:p.location.y+1,z:p.location.z};
 F.converge(d,c,3,30,F.C.gold);F.flash(d,c,5,F.C.gold);F.sfx(d,'sparkmod.titan.reboot',c,2,1.3);
 tell(p,'§6⚡ Spark Chestplate recharged! The drain is lifted.');
}
