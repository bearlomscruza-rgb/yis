// V144: Native Warden challenge, Colosseum of Prizes.
// Deposit five Spark Tokens into the central Colosseum prize chest to start.
import {world,system,ItemStack} from '@minecraft/server';
const TAG='sparkmod:arena_warden_v144';
const CX=1750,CZ=1500,R=57;
const fights=new Map();
const pendingKey='sparkmod:arena_pending_winners';
let spawning=false;
let encounterLocked=false; // Lock persists if the Warden burrows or unloads.
let lastSpawnTick=-999999;
function active(dim){
 return spawning||encounterLocked||(system.currentTick-lastSpawnTick<200)||[...fights.values()].some(f=>safe(()=>f.warden.isValid,false))||
 safe(()=>dim.getEntities({type:'minecraft:warden'}).some(e=>e.hasTag(TAG)),false);
}

const safe=(fn,otherwise)=>{try{return fn()}catch(e){console.warn('[SparkMod Arena] '+String(e));return otherwise}};
const near=(a,b)=>((a.x-b.x)**2+(a.z-b.z)**2)<=R*R;
const display=(p,t)=>safe(()=>p.onScreenDisplay.setActionBar(t));
const players=(dim,center)=>dim.getPlayers({location:center,maxDistance:65,excludeGameModes:['creative','spectator']});
function summon(p){
 if(p.dimension.id!=='minecraft:overworld'||!near(p.location,{x:CX,z:CZ})){
  p.sendMessage('§cThe Warden can only be summoned from the Colosseum prize chest.');return false;
 }
 const dim=p.dimension;
 if(active(dim)){p.sendMessage('§cAn arena Warden challenge is already active.');return false;}
 const ground=safe(()=>dim.getTopmostBlock({x:CX,z:CZ}));
 if(!ground){p.sendMessage('§cThe arena center must be loaded first.');return false;}
 // Center plinth may have a chest: offset slightly to avoid trapping the mob.
 const loc={x:CX+3.5,y:ground.location.y+2,z:CZ+4.5};
 spawning=true;
 const w=safe(()=>dim.spawnEntity('minecraft:warden',loc));
 spawning=false;
 if(!w){p.sendMessage('§cUnable to summon the Warden.');return false;}
 encounterLocked=true;lastSpawnTick=system.currentTick;
 safe(()=>w.addTag(TAG));safe(()=>w.nameTag='§e§lCOLOSSEUM WARDEN');
 fights.set(w.id,{warden:w,damage:new Map(),lastHealth:500,started:system.currentTick});
 for(const q of players(dim,loc))q.sendMessage('§6⚔ Colosseum challenge started! Highest damage wins §e5 Sparkite§6.');
 return true;
}
// V158: A token deposited in the prize chest is the ONLY way to start a fight.
// Do not allow /scriptevent sparkmod:arena to bypass the token requirement.
const TOKEN='sparkmod:spark_token';
let lastMissingChestNotice=0;
function chestAtCenter(dim){
 // The generated chest is at (1750, arenaFloorY+3, 1500).
 // Scan a small vertical window around the highest solid block at the center,
 // so older worlds and varying terrain heights still work.
 const top=safe(()=>dim.getTopmostBlock({x:CX,z:CZ}));
 if(!top)return;
 const base=top.location.y;
 for(let dy=3;dy>=-18;dy--){
  const block=safe(()=>dim.getBlock({x:CX,y:base+dy,z:CZ}));
  if(block?.typeId==='minecraft:chest')return block;
 }
}
function checkPrizeChest(){
 const dim=world.getDimension('overworld');
 // X/Z-only proximity check supports arenas at any terrain height.
 const visitors=dim.getPlayers().filter(p=>near(p.location,{x:CX,z:CZ}));
 if(!visitors.length)return;
 const chest=chestAtCenter(dim);
 if(!chest)return;
 const inv=safe(()=>chest.getComponent('minecraft:inventory')?.container);
 if(!inv)return;
 let slot=-1,stack;
 for(let i=0;i<inv.size;i++){
  const item=safe(()=>inv.getItem(i));
  if(item?.typeId===TOKEN&&item.amount>=5){slot=i;stack=item;break;}
 }
 if(slot<0)return;
 // Don't consume additional tokens while a Warden is active.
 if(active(dim))return;
 const starter=visitors[0];
 // Only take payment after successful spawning.
 if(!summon(starter))return;
 try{
  // Clear the entire chest immediately after the ONE successful summon.
  // This also removes extra Spark Tokens so they cannot start a second fight.
  inv.clearAll();
  for(const p of visitors)p.sendMessage('§e⚡ Five Spark Tokens activated the Warden! The prize chest has been emptied.');
 }catch(e){console.warn('[SparkMod Arena] Chest clearing failed: '+String(e));}
}
system.runInterval(checkPrizeChest,20);
world.afterEvents.entityHurt.subscribe(ev=>{
 const victim=ev.hurtEntity,source=ev.damageSource?.damagingEntity;
 // Arena Warden outgoing damage is reduced by 55% (refund 55% of the damage).
 // The after-hurt API cannot save players from otherwise fatal hits; native damage
 // events do not provide a reliably writable amount in every Bedrock version.
 if(source?.typeId==='minecraft:warden'&&safe(()=>source.hasTag(TAG),false)){
  const hp=safe(()=>victim.getComponent('minecraft:health'));
  if(hp&&hp.currentValue>0&&ev.damage>0){
   const recovered=Math.min(hp.effectiveMax,hp.currentValue+ev.damage*0.55);
   safe(()=>hp.setCurrentValue(recovered));
  }
 }
 // Count actual Warden health lost, not weapon's claimed damage or overkill.
 if(victim?.typeId!=='minecraft:warden'||!safe(()=>victim.hasTag(TAG),false))return;
 const f=fights.get(victim.id);if(!f)return;
 const attacker=source?.typeId==='minecraft:player'?source:safe(()=>ev.damageSource?.damagingProjectile?.getComponent('minecraft:projectile')?.owner);
 if(attacker?.typeId!=='minecraft:player')return;
 const remaining=Math.max(0,safe(()=>victim.getComponent('minecraft:health')?.currentValue,0));
 const actual=Math.max(0,Math.min(ev.damage,f.lastHealth,500));
 f.damage.set(attacker.name,(f.damage.get(attacker.name)||0)+actual);
 f.lastHealth=remaining;
});
// Rewards are credited to the winner, never spawned as collectible items.
// A full inventory leaves a saved balance which is delivered when space opens.
function creditWinner(name,n){
 const data=safe(()=>JSON.parse(world.getDynamicProperty(pendingKey)||'{}'),{});
 data[name]=(data[name]||0)+n;
 safe(()=>world.setDynamicProperty(pendingKey,JSON.stringify(data)));
 for(const p of world.getAllPlayers())if(p.name===name)deliver(p);
}
function deliver(p){
 const data=safe(()=>JSON.parse(world.getDynamicProperty(pendingKey)||'{}'),{});
 const n=data[p.name]||0;if(n<1)return;
 const inv=safe(()=>p.getComponent('minecraft:inventory')?.container);
 if(!inv)return;
 const qty=Math.min(n,64);
 const leftover=safe(()=>inv.addItem(new ItemStack('sparkmod:sparkite',qty)),new ItemStack('sparkmod:sparkite',qty));
 const delivered=qty-(leftover?.amount||0);if(delivered<1)return;
 data[p.name]-=delivered;
 safe(()=>world.setDynamicProperty(pendingKey,JSON.stringify(data)));
 p.sendMessage('§a§l+'+delivered+' Sparkite! §r§7Highest Colosseum Warden damage.');
}
system.runInterval(()=>{for(const p of world.getAllPlayers())deliver(p);},40);
function removeColosseumSculkDrop(dim,at){
 // Remove only a freshly dropped catalyst very close to this defeated boss.
 // Vanilla entity drops are typically created after the death callback.
 for(const item of safe(()=>dim.getEntities({type:'minecraft:item',location:at,maxDistance:3}),[])){
  const stack=safe(()=>item.getComponent('minecraft:item')?.itemStack);
  if(stack?.typeId==='minecraft:sculk_catalyst')safe(()=>item.remove());
 }
}
world.afterEvents.entityDie.subscribe(ev=>{
 const dead=ev.deadEntity;
 if(dead?.typeId!=='minecraft:warden')return;
 const f=fights.get(dead.id);if(!f)return;
 fights.delete(dead.id);encounterLocked=false;
 // A tagged Colosseum Warden defeat unlocks the altar and forge for the ENTIRE WORLD.
 // This world dynamic property persists across sessions and applies to future joiners.
 const key='sparkmod:colosseum_warden_cleared';
 const previouslyUnlocked=safe(()=>world.getDynamicProperty(key)===true,false);
 const saved=safe(()=>{world.setDynamicProperty(key,true);return true;},false);
 if(saved&&!previouslyUnlocked){
  for(const fighter of world.getAllPlayers())fighter.sendMessage('§a§l⚡ SPARK ALTAR UNLOCKED FOR EVERYONE! §r§7The Colosseum Warden has been defeated. All current and future players can use the Spark Altar and Spark Forge.');
 }
 if(!saved)console.warn('[SparkMod Arena] Failed to save world-wide altar unlock.');
 const ordered=[...f.damage].sort((a,b)=>b[1]-a[1]);
 const dim=dead.dimension;
 const winnerName=ordered.length?ordered[0][0]:undefined;
 const winner=world.getAllPlayers().find(p=>p.name===winnerName);
 for(const q of players(dim,dead.location))q.sendMessage(winnerName?`§6🏆 ${winnerName} dealt the most damage (${Math.round(ordered[0][1])}) and wins §e5 Sparkite§6!`:'§7Warden defeated, but no player damage was recorded.');
 // Remove the vanilla Warden sculk catalyst, only for this tagged arena boss.
 const deathPos={...dead.location};
 system.runTimeout(()=>removeColosseumSculkDrop(dim,deathPos),1);
 system.runTimeout(()=>removeColosseumSculkDrop(dim,deathPos),3);
 if(winnerName)creditWinner(winnerName,5);
});
system.runInterval(()=>{
 if(!fights.size){
  const dim=world.getDimension('overworld');
  const w=safe(()=>dim.getEntities({type:'minecraft:warden'}).find(e=>e.hasTag(TAG)),undefined);
  if(w){encounterLocked=true;fights.set(w.id,{warden:w,damage:new Map(),lastHealth:500,started:system.currentTick});}
 }
 for(const [id,f] of fights){
  const w=f.warden;
  if(!safe(()=>w.isValid,false)){
   // Keep arena locked while a Warden is temporarily unloaded or burrowing.
   if(system.currentTick-f.started>12000){fights.delete(id);encounterLocked=false;}
   continue;
  }
  const hp=Math.max(0,safe(()=>w.getComponent('minecraft:health')?.currentValue,500));
  f.lastHealth=hp;
  const frac=Math.max(0,Math.min(1,hp/500));
  const bars=Math.round(frac*20);
  const bar='§e'+'▮'.repeat(bars)+'§8'+'▯'.repeat(20-bars);
  for(const p of players(w.dimension,w.location))display(p,`§6⚔ COLOSSEUM WARDEN §f${Math.ceil(hp)}/500 §r${bar}`);
 }
},10);
