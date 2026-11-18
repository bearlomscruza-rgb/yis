import {world,system,ItemStack,InputPermissionCategory} from '@minecraft/server';
import {recordTitanLightning} from './titan_player_damage_v201.js';
import * as F from './titan_fx_v217.js';
const BASE='sparkmod:bolt_titan',GIANT='sparkmod:bolt_titan_phase3',DEMON='sparkmod:spark_demon';
const TYPES=[BASE,GIANT,DEMON],LOCK='sparkmod:bolt_titan_defeated',PENDING='sparkmod:titan_transitions',STUN='sparkmod:titan_stun',RANK='sparkmod:titan_damage';
const fights=new Map();
// V199: tracked cannon cooldowns and emergence animation state.
const cannonCooldown=new Map(), emergenceUntil=new Map();
const RAGE_END='sparkmod:rage_end_at',RAGE_HEALTH='sparkmod:rage_before_hp';
const RAGE_MS=30_000;
const BASE_MAX_HP={[BASE]:1000,[GIANT]:2000};
const powerScale=b=>Date.now()<Number(safe(()=>b.getDynamicProperty(RAGE_END),0)||0)?1.5:1;

const CASTING='sparkmod:casting';
// V217: final-phase shutdown cycle.
const SHUT='sparkmod:shutdown';
const isShutdown=b=>b?.typeId===GIANT&&safe(()=>b.getProperty(SHUT),false)===true;
const casts=new Map();
function beginAbilityCast(b,duration=14){
 if(!alive(b))return;
 const until=system.currentTick+duration;
 casts.set(b.id,until);
 safe(()=>b.setProperty(CASTING,true));
 system.runTimeout(()=>safe(()=>{
  if(!alive(b))return;
  if((casts.get(b.id)||0)<=system.currentTick)b.setProperty(CASTING,false);
 }),duration+1);
}
const damageScale=1.5; // 50% bigger damage hitboxes / melee reach.
function meleeReach(b){return (b.typeId===GIANT?7.5:6.9)*powerScale(b);} 

function syncRageHealth(b,percent,expectedMax){
 system.runTimeout(()=>safe(()=>{
  if(!alive(b))return;
  const h=b.getComponent('minecraft:health');
  if(h&&Math.abs(h.effectiveMax-expectedMax)<1)h.setCurrentValue(Math.max(1,Math.min(h.effectiveMax,percent*h.effectiveMax)));
 }),3);
}
function beginScreamRage(b){
 if(!alive(b))return;
 const until=Date.now()+RAGE_MS;
 const active=Number(safe(()=>b.getDynamicProperty(RAGE_END),0)||0)>Date.now();
 // Repeating the scream during the buff refreshes its timer only.
 b.setDynamicProperty(RAGE_END,until);
 if(active)return;
 const h=b.getComponent('minecraft:health');
 const fraction=h?Math.max(.001,h.currentValue/h.effectiveMax):1;
 b.triggerEvent('sparkmod:rage_on');
 syncRageHealth(b,fraction,BASE_MAX_HP[b.typeId]*1.5);
 safe(()=>b.dimension.playSound('mob.warden.roar',b.location,{volume:2,pitch:.55}));
 empoweredRing(b.dimension,b.location,8,40);
}
function endScreamRage(b){
 if(isShutdown(b))return; // finish the rage after rebooting
 const end=Number(safe(()=>b.getDynamicProperty(RAGE_END),0)||0);
 if(!end||Date.now()<end)return;
 const h=b.getComponent('minecraft:health');
 const fraction=h?Math.max(.001,h.currentValue/h.effectiveMax):1;
 b.setDynamicProperty(RAGE_END,undefined);
 b.triggerEvent('sparkmod:rage_off');
 syncRageHealth(b,fraction,BASE_MAX_HP[b.typeId]);
}

// Warden-inspired investigation, with closest-player targeting overriding anger.
const senses=new Map();
function sense(b){let a=senses.get(b.id);if(!a){a={anger:new Map(),investigate:null,until:0,lastBoom:0};senses.set(b.id,a);}return a;}
function aggro(b,e,amount){if(!isTarget(e))return;const a=sense(b);a.anger.set(e.id,Math.min(150,(a.anger.get(e.id)||0)+amount));a.investigate={...e.location};a.until=system.currentTick+160;}
// Abilities require an actual combat engagement, not simply a creature somewhere in range.
// Engagement begins when attacked or when an eligible target comes within melee pursuit range.
// Always prioritize the nearest eligible player, not the most angry entity.
// The nearest player is re-evaluated every AI tick and each time an ability fires.
// The 96-block radius matches the Bedrock target selector's normal tracking range.
const PLAYER_LOCK_RANGE=96;
function closestPlayer(b){
 const ps=safe(()=>b.dimension.getPlayers({location:b.location,maxDistance:PLAYER_LOCK_RANGE*powerScale(b)}),[]);
 let best=null, bestDist=Infinity;
 for(const p of ps){
  if(!isTarget(p))continue; // ignores creative, spectator and invalid players
  const d=dist(p.location,b.location);
  if(d<bestDist){best=p;bestDist=d;}
 }
 return best;
}
function faceEnemy(b,target){
 if(!target || !alive(b))return;
 const dx=target.location.x-b.location.x,dz=target.location.z-b.location.z;
 const horizontal=Math.hypot(dx,dz);
 if(horizontal<.02)return;
 const yaw=Math.atan2(-dx,dz)*180/Math.PI;
 const height=target.location.y+1.2-(b.location.y+2.2*powerScale(b));
 const pitch=Math.max(-30,Math.min(30,-Math.atan2(height,horizontal)*180/Math.PI));
 safe(()=>b.setRotation({x:pitch,y:yaw}));
}
function combatTarget(b){
 // Always prefer the closest eligible player, preserving the V189 rule.
 const player=closestPlayer(b);
 if(player)return player;
 // Without a player, lock the closest living mob, even before it attacks.
 return safe(()=>targets(b,64*powerScale(b)).find(e=>e.typeId!=='minecraft:player'),null);
}
// Phase 2 (cracked base Titan): short-range combat teleport with cooldown.
const teleportCooldown=new Map();
function phaseTwoTeleport(b){
 if(b.typeId!==BASE)return;
 const health=b.getComponent('minecraft:health');
 if(!health || health.currentValue>health.effectiveMax*.35)return;
 const t=combatTarget(b);
 if(!isTarget(t))return;
 const now=system.currentTick;
 if(now<(teleportCooldown.get(b.id)||0))return;
 const gap=Math.sqrt(dist(b.location,t.location));
 if(gap<7||gap>50)return;
 const v={x:b.location.x-t.location.x,z:b.location.z-t.location.z};
 const length=Math.hypot(v.x,v.z)||1;
 const p={x:t.location.x+v.x/length*3,y:t.location.y,z:t.location.z+v.z/length*3};
 // Teleport only when there is enough empty space for the boss.
 const dim=b.dimension,base={x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)};
 const clear=safe(()=>[0,1,2,3].every(d=>{
  const block=dim.getBlock({x:base.x,y:base.y+d,z:base.z});
  return block && (block.isAir||block.isLiquid);
 }),false);
 if(!clear)return;
 teleportCooldown.set(b.id,now+160); // 8-second Phase 2 teleport cooldown
 empoweredSpark(dim,{x:b.location.x,y:b.location.y+1,z:b.location.z},'gold_spark');
 const from=F.core(b);
 F.flash(dim,from,4,F.C.gold);F.sparks(dim,from,24,7,F.C.gold);F.sfx(dim,'sparkmod.titan.teleport',from,1.6,.8);
 safe(()=>b.teleport(p,{dimension:dim,facingLocation:t.location,checkForBlocks:true}));
 const to={x:p.x,y:p.y+2.3,z:p.z};
 F.bolt(dim,from,to,{color:F.C.gold,size:.4,branches:2},6);
 F.flash(dim,to,4,F.C.gold);F.shock(dim,p,4,F.C.gold,.5);F.sfx(dim,'sparkmod.titan.teleport',to,1.6,1.2);F.sfx(dim,'sparkmod.titan.zap',to,1.5,.8);
 empoweredSpark(dim,{x:p.x,y:p.y+1,z:p.z},'gold_spark');
}
function wardentick(b){
 const a=sense(b),now=system.currentTick;
 for(const [id,n] of a.anger)a.anger.set(id,Math.max(0,n-.5));
 const chosen=combatTarget(b);
 if(chosen){
  a.investigate={...chosen.location};a.until=now+160;
  // Every active target, including passive mobs, can trigger Warden-like abilities.
  a.anger.set(chosen.id,Math.max(65,a.anger.get(chosen.id)||0));
  faceEnemy(b,chosen);
  const distance=Math.sqrt(dist(chosen.location,b.location));
  if(now-a.lastBoom>100 && distance>meleeReach(b) && distance<=60*powerScale(b)){
   a.lastBoom=now;
   sparkBoom(b,b.typeId===GIANT);
  }else if(distance>4 && now%20===0){
   const v={x:chosen.location.x-b.location.x,z:chosen.location.z-b.location.z};
   const l=Math.hypot(v.x,v.z)||1;
   safe(()=>b.applyImpulse({x:v.x/l*.14,y:0,z:v.z/l*.14}));
  }
 }else if(a.investigate && now<a.until && now%20===0){
  const v={x:a.investigate.x-b.location.x,z:a.investigate.z-b.location.z};
  const l=Math.hypot(v.x,v.z)||1;
  if(l>2)safe(()=>b.applyImpulse({x:v.x/l*.09,y:0,z:v.z/l*.09}));
 }
}
world.afterEvents.entityHurt.subscribe(({hurtEntity,damageSource})=>{
 if(![BASE,GIANT].includes(hurtEntity.typeId))return;
 const attacker=damageSource?.damagingEntity;if(attacker)aggro(hurtEntity,attacker,90);
});

const safe=(fn,fallback)=>{try{return fn();}catch(e){console.warn('[Bolt Titan] '+String(e));return fallback;}};
const defeated=()=>world.getDynamicProperty(LOCK)===true;
const alive=e=>e?.isValid && (e.getComponent('minecraft:health')?.currentValue??0)>0;
const dist=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2;
const read=(e,k,f)=>safe(()=>JSON.parse(e.getDynamicProperty(k)||'null'),f)??f;
const spark=(d,p,kind='gold_spark')=>safe(()=>{
 d.spawnParticle('sparkmod:'+kind,p);
 // Add the user's requested extra particles to all Bolt Titan attacks.
 d.spawnParticle('sparkmod:orange_star',{x:p.x+.06,y:p.y+.02,z:p.z-.04});
 d.spawnParticle('sparkmod:ice_diamond',{x:p.x-.05,y:p.y+.08,z:p.z+.05});
});
function ring(d,p,r,n=32,kind='spark_shockwave'){for(let i=0;i<n;i++){const a=i*2*Math.PI/n;spark(d,{x:p.x+Math.cos(a)*r,y:p.y+.4,z:p.z+Math.sin(a)*r},kind);}}
// 200% more particles means 3x as many particles as V189, *not* triple damage.
// Stagger additional rings across two ticks to avoid a sudden one-frame particle spike.
function empoweredRing(d,p,r,n=32,kind='spark_shockwave'){
 ring(d,p,r,n,kind);
 system.runTimeout(()=>ring(d,{x:p.x,y:p.y+.18,z:p.z},r+.22,n,kind),1);
 system.runTimeout(()=>ring(d,{x:p.x,y:p.y+.36,z:p.z},Math.max(.2,r-.22),n,kind),2);
}

function sparkBoomBlueRing(d,p,r=2.4){
 empoweredRing(d,{x:p.x,y:p.y+.2,z:p.z},r,34,'boom_ring_blue');
 system.runTimeout(()=>empoweredRing(d,{x:p.x,y:p.y+.55,z:p.z},Math.max(0.6,r-.35),28,'boom_ring_blue'),2);
}

function empoweredSpark(d,p,kind='gold_spark'){
 spark(d,p,kind);
 system.runTimeout(()=>spark(d,{x:p.x+.22,y:p.y+.25,z:p.z-.18},kind),1);
 system.runTimeout(()=>spark(d,{x:p.x-.22,y:p.y+.48,z:p.z+.18},kind),2);
}
function enhancedSonicBeam(d,o,u,reach,big){
 // V189 spawned one line for Phase1 and 3 lines for Phase3.
 // Each extra pass adds the same count; three passes = precisely 3x the V189 density.
 const perp={x:-u.z,z:u.x};
 const plen=Math.hypot(perp.x,perp.z)||1;perp.x/=plen;perp.z/=plen;
 for(let pass=0;pass<3;pass++)system.runTimeout(()=>{
  const shift=(pass-1)*.35;
  for(let step=0;step<=reach;step+=.6){
   const p={x:o.x+u.x*step+perp.x*shift,y:o.y+u.y*step+shift*.4,z:o.z+u.z*step+perp.z*shift};
   spark(d,p,'spark_sonic');
   if(big){spark(d,{x:p.x+perp.x*.4,y:p.y,z:p.z+perp.z*.4},'spark_sonic');
           spark(d,{x:p.x-perp.x*.4,y:p.y,z:p.z-perp.z*.4},'spark_sonic');}
  }
 },pass);
}

function isTarget(e){
 if(!e || TYPES.includes(e.typeId) || e.typeId==='minecraft:armor_stand')return false;
 if(!safe(()=>alive(e),false))return false;
 if(e.typeId==='minecraft:player'){
  const mode=safe(()=>String(e.getGameMode()).toLowerCase(),'survival');
  if(mode==='creative'||mode==='spectator')return false;
 }
 return true;
}
function targets(b,r){return b.dimension.getEntities({location:b.location,maxDistance:r}).filter(isTarget).sort((a,c)=>dist(a.location,b.location)-dist(c.location,b.location));}
function players(b,r){return b.dimension.getPlayers({location:b.location,maxDistance:r}).filter(isTarget);}
// All attack damage is server-applied to living, eligible targets.
// Bedrock may reject applyDamage during damage-immunity ticks; only then
// set health directly, allowing hits to land even when native collision fails.
function hit(b,e,damage){
 if(!alive(b)||!isTarget(e)||b.dimension.id!==e.dimension.id)return false;
 const amount=damage*powerScale(b);
 const health=safe(()=>e.getComponent('minecraft:health'),null);
 if(!health || health.currentValue<=0)return false;
 const before=health.currentValue;
 const key=b.id+':'+e.id;
 scriptedDamageInFlight.add(key);
 let applied;
 try{applied=safe(()=>e.applyDamage(amount,{cause:'entityAttack',damagingEntity:b}),false);}
 finally{scriptedDamageInFlight.delete(key);}
 if(applied===true || !alive(e) || health.currentValue<before)return true;
 // This fallback applies only to server-valid entities and keeps Creative/Spectator immune.
  const fallbackAmount=e.typeId==='minecraft:player'?amount*0.5:amount;
  return safe(()=>{health.setCurrentValue(Math.max(0,before-fallbackAmount));return true;},false);
}
function splash(b,center,radius,damage,alreadyScaled=false){const adjusted=alreadyScaled?radius:radius*powerScale(b);for(const e of b.dimension.getEntities({location:center,maxDistance:adjusted+4}).filter(isTarget)){const loc=e.location;const dx=loc.x-center.x,dz=loc.z-center.z;if(dx*dx+dz*dz<=(adjusted+1.5)**2&&Math.abs(loc.y-center.y)<=Math.max(7,adjusted*.6))hit(b,e,damage);}}
function later(b,t,fn){system.runTimeout(()=>safe(()=>{if(!defeated()&&alive(b)&&!isShutdown(b))fn();}),t);}
function removeLocked(e){if(TYPES.includes(e.typeId)&&defeated()){fights.delete(e.id);e.remove();return true;}return false;}
world.afterEvents.entitySpawn.subscribe(({entity})=>safe(()=>removeLocked(entity)));
// Store the old input setting on the player, so a disconnect/restart cannot strand them.
export function stun(p,seconds){
 const old=read(p,STUN,null);
 const data={until:Math.max(old?.until||0,Date.now()+seconds*1000),movement:old?.movement??p.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement)};
 p.setDynamicProperty(STUN,JSON.stringify(data));
 p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement,false);
}
function restore(p,force=false){
 const s=read(p,STUN,null);if(!s)return;
 if(force||Date.now()>=s.until){p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement,s.movement);p.setDynamicProperty(STUN,undefined);}
 else p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement,false);
}
system.runInterval(()=>{for(const p of world.getAllPlayers())safe(()=>restore(p));},1);
world.afterEvents.playerSpawn.subscribe(({player})=>system.run(()=>safe(()=>restore(player,true))));
function state(b){let s=fights.get(b.id);if(!s){s={next:system.currentTick+60,cycle:0};fights.set(b.id,s);}return s;}
function phase(b){const h=b.getComponent('minecraft:health');if(h)b.setProperty('sparkmod:cracked',b.typeId===GIANT||h.currentValue<=h.effectiveMax*.35);}
// Iron Golem-inspired double-arm wind-up, synced to all clients.
// The old entityHurt trigger incorrectly played the melee animation for sonic/distant ability damage.
// Start the wind-up near an actual target, before impact; use entityHitEntity as a fallback.
const swings=new Map();
const meleeCooldown=new Map();
const scriptedDamageInFlight=new Set();
const MELEE_COOLDOWN_TICKS=40; // Two seconds at 20 TPS. Shared by native and scripted melee.
// A native attack and the scripted backup must obey the same cooldown.
// Damage from named abilities is applied through hit() and bypasses ONLY this
// melee timer, not the existing player-only 50% damage reduction.
world.beforeEvents.entityHurt.subscribe(ev=>{
 const b=ev.damageSource?.damagingEntity;
 if(![BASE,GIANT].includes(b?.typeId) || ev.damageSource?.cause!=='entityAttack')return;
 if(scriptedDamageInFlight.has(b.id+':'+ev.hurtEntity.id))return;
 const now=system.currentTick;
 if(now<(meleeCooldown.get(b.id)||0))ev.cancel=true;
 else meleeCooldown.set(b.id,now+MELEE_COOLDOWN_TICKS);
});
const vanillaHits=new Map();
function golemSwing(b){
 if(!alive(b)||![BASE,GIANT].includes(b.typeId))return;
 const now=system.currentTick,prev=swings.get(b.id)||-999;
 if(now-prev<17)return; // 0.85s between 0.80s attacks
 swings.set(b.id,now);
 safe(()=>{
  b.setProperty('sparkmod:attacking',false);
  system.runTimeout(()=>safe(()=>{if(alive(b))b.setProperty('sparkmod:attacking',true);}),1);
  system.runTimeout(()=>safe(()=>{if(alive(b))b.setProperty('sparkmod:attacking',false);}),17);
 });
}
world.afterEvents.entityHitEntity.subscribe(({damagingEntity})=>{
 if([BASE,GIANT].includes(damagingEntity?.typeId))golemSwing(damagingEntity);
});
world.afterEvents.entityHurt.subscribe(({hurtEntity,damageSource,damage})=>{
 const attacker=damageSource?.damagingEntity;
 if(![BASE,GIANT].includes(attacker?.typeId) || !(damage>0))return;
 vanillaHits.set(attacker.id+':'+hurtEntity.id,system.currentTick);
});
// The native melee AI sometimes loses the player/mob target. This is a guarded
// backup strike: play the Iron Golem animation first, then apply real damage
// only if a valid target is still close enough at the moment of impact.
function scriptedMelee(b){
 const target=combatTarget(b);
 if(!target)return;
 const current=system.currentTick;
 if(current<(meleeCooldown.get(b.id)||0))return;
 if(safe(()=>b.getProperty('sparkmod:casting'),false))return;
 const reach=meleeReach(b);
 const d=Math.sqrt(dist(target.location,b.location));
 if(d>reach || Math.abs(target.location.y-b.location.y)>4*powerScale(b))return;
 meleeCooldown.set(b.id,current+MELEE_COOLDOWN_TICKS); // Two-second melee cooldown.
 faceEnemy(b,target);
 golemSwing(b);
 const locked=target;
 later(b,8,()=>{
  if(!isTarget(locked) || b.dimension.id!==locked.dimension.id)return;
  const d=Math.sqrt(dist(locked.location,b.location));
  if(d>meleeReach(b)+4*powerScale(b))return;
  if(Math.abs(locked.location.y-b.location.y)>5*powerScale(b))return;
  faceEnemy(b,locked);
  const key=b.id+':'+locked.id;
  if(system.currentTick-(vanillaHits.get(key)||-1000)<=12)return;
  hit(b,locked,b.typeId===GIANT?24:12);
 });
}

world.afterEvents.entityHurt.subscribe(e=>{
 if(![BASE,GIANT].includes(e.hurtEntity.typeId))return;
 safe(()=>{
  const b=e.hurtEntity;phase(b);
  const a=e.damageSource.damagingEntity;
  if(a?.typeId==='minecraft:player'){
   const rank=read(b,RANK,{});rank[a.name]=(rank[a.name]||0)+Math.max(0,e.damage);b.setDynamicProperty(RANK,JSON.stringify(rank));
  }
 });
});
// 1. Spark Stun: nearest eligible player in 50 blocks, three seconds.
function sparkStun(b,big){beginAbilityCast(b,12);const p=combatTarget(b);if(!p)return;
 {const d=b.dimension,from=F.core(b),to={x:p.location.x,y:p.location.y+1,z:p.location.z},col=big?F.C.purple:F.C.cyan;
  F.sfx(d,'sparkmod.titan.zap',from,2,.7);F.sfx(d,'sparkmod.titan.zap',to,2,1.1);
  F.bolt(d,from,to,{color:col,size:.42,branches:3},8);
  F.sparks(d,to,30,7,F.C.gold);F.pulse(d,to,5,col,.4);F.shock(d,p.location,(big?5:3)*damageScale,col,.6);
  F.cage(d,p,Math.round((big?4:3)*powerScale(b)*20),col);F.shake(d,to,12,.6,.4);}
 empoweredRing(p.dimension,p.location,(big?5:3)*damageScale);if(p.typeId==='minecraft:player')stun(p,(big?4:3)*powerScale(b));hit(b,p,big?12:7);splash(b,p.location,(big?9:6)*damageScale,big?9:5);}
// 2. Spark Boom: fixed, telegraphed yellow sonic beam, including through walls.
function sparkBoom(b,big){
 const initial=combatTarget(b);if(!initial)return;
 beginAbilityCast(b,27);
 const d=b.dimension;
 safe(()=>d.playSound('mob.warden.sonic_charge',b.location));
 F.sfx(d,'sparkmod.titan.charge',F.core(b),2.5,big?.8:1);
 empoweredRing(d,initial.location,1.5);
 F.warn(d,initial.location,2.5,24,big?F.C.purple:F.C.red);
 for(let t=0;t<24;t+=3)later(b,t,()=>{
  const c=F.core(b),k=t/24;
  F.converge(d,c,3.5-k*1.5,10,big?F.C.purple:F.C.gold);
  F.orb(d,c,.6+k*1.8,big?F.C.purple:F.C.gold,.2);
  if(t%6===0)F.arc(d,c,{x:c.x+(Math.random()-.5)*6,y:b.location.y,z:c.z+(Math.random()-.5)*6},{color:F.C.cyan,size:.2,branches:0,max:40});
 });
 later(b,24,()=>{
  // Aim at the actual locked target position at the moment of firing.
  const t=isTarget(initial)?initial:combatTarget(b);
  if(!t || !isTarget(t) || t.dimension.id!==b.dimension.id)return;
  const o={x:b.location.x,y:b.location.y+(big?5:2.5),z:b.location.z};
  const end={x:t.location.x,y:t.location.y+1,z:t.location.z};
  const v={x:end.x-o.x,y:end.y-o.y,z:end.z-o.z};const len=Math.hypot(v.x,v.y,v.z)||1;
  const reach=(big?65:45)*powerScale(b),width=(big?7:4.5)*powerScale(b)*damageScale;
  if(len>reach+width)return;
  const u={x:v.x/len,y:v.y/len,z:v.z/len};
  faceEnemy(b,t);
  safe(()=>d.playSound('mob.warden.sonic_boom',o));
  F.sfx(d,'sparkmod.titan.beam',o,3,big?.75:1);
  enhancedSonicBeam(d,o,u,reach,big);
  {const col=big?F.C.purple:F.C.gold,beamLen=Math.min(reach,len+2);
   for(let s2=0;s2<=beamLen;s2+=1.2)F.orb(d,{x:o.x+u.x*s2,y:o.y+u.y*s2,z:o.z+u.z*s2},big?1.6:1.1,col,.35,.8);
   for(let s2=3;s2<=beamLen;s2+=5)system.runTimeout(()=>F.pulse(d,{x:o.x+u.x*s2,y:o.y+u.y*s2,z:o.z+u.z*s2},big?5:3.5,F.C.cyan,.4),Math.floor(s2/5));
   F.bolt(d,o,end,{color:F.C.white,size:.3,branches:2},6);
   F.flash(d,o,4,col);F.flash(d,end,5,col);F.sparks(d,end,40,9,F.C.gold);
   F.sfx(d,'sparkmod.titan.impact',end,2.5,1);F.shake(d,o,30,1.0,.6);}
  const hitIds=new Set();
  // Guaranteed hit on the beam's locked target when it remains in range.
  if(hit(b,t,big?32:18))hitIds.add(t.id);
  for(const e of targets(b,reach+width+8)){
   if(hitIds.has(e.id))continue;
   const delta={x:e.location.x-o.x,y:e.location.y+1-o.y,z:e.location.z-o.z};
   const along=delta.x*u.x+delta.y*u.y+delta.z*u.z;
   const off=delta.x*delta.x+delta.y*delta.y+delta.z*delta.z-along*along;
   if(along>=-2&&along<=reach+2&&off<=(width+1.5)**2)hit(b,e,big?32:18);
  }
 });
}
// Spark Overload: a new massive ranged beam unlocked at under 30% HP.
// A successful cast enters a cooldown, even if the player leaves mid-charge.
const OVERLOAD_COOLDOWN_TICKS=220; // 11 seconds at 20 ticks per second.
const overloadCooldown=new Map();
function overloadReady(b){
 const h=safe(()=>b.getComponent('minecraft:health'));
 return !!h && h.effectiveMax>0 && h.currentValue>0 &&
  h.currentValue/h.effectiveMax<.30 &&
  system.currentTick>=(overloadCooldown.get(b.id)||0);
}
function overloadBeam(b){
 if(!overloadReady(b))return false;
 const initial=combatTarget(b);
 if(!initial)return false;
 overloadCooldown.set(b.id,system.currentTick+OVERLOAD_COOLDOWN_TICKS);
 beginAbilityCast(b,36); // visible custom charge animation
 const big=b.typeId===GIANT, dim=b.dimension;
 const origin={x:b.location.x,y:b.location.y+(big?3.3:2.8),z:b.location.z};
 safe(()=>dim.playSound('mob.warden.sonic_charge',origin,{volume:2,pitch:.65}));
 // Telegraph the powerful beam with two charging circles.
 empoweredRing(dim,origin,3.5,36,'titan_overload_beam');
 later(b,14,()=>empoweredRing(b.dimension,b.location,5,32,'titan_overload_beam'));
 F.sfx(dim,'sparkmod.titan.charge_long',origin,4,.8);
 F.warn(dim,b.location,8,32,F.C.cyan);F.shake(dim,origin,40,.4,1.6);
 for(let t=0;t<32;t+=2)later(b,t,()=>{
  const c=F.core(b),k=t/32;
  F.converge(dim,c,6-k*3,18,F.C.cyan);
  F.orb(dim,c,1+k*4,F.C.cyan,.15);F.orb(dim,c,.5+k*2,F.C.white,.15);
  if(t%4===0)F.arc(dim,{x:c.x+(Math.random()-.5)*12,y:b.location.y,z:c.z+(Math.random()-.5)*12},c,{color:F.C.cyan,size:.3,branches:1,max:60});
 });
 later(b,32,()=>{
  const target=combatTarget(b);
  if(!target)return;
  const start={x:b.location.x,y:b.location.y+(big?3.3:2.8),z:b.location.z};
  const aim={x:target.location.x,y:target.location.y+1.1,z:target.location.z};
  const delta={x:aim.x-start.x,y:aim.y-start.y,z:aim.z-start.z};
  const length=Math.hypot(delta.x,delta.y,delta.z)||1;
  const u={x:delta.x/length,y:delta.y/length,z:delta.z/length};
  const reach=70*powerScale(b),radius=5.5*powerScale(b);
  // An enormous cyan beam with a thick cross-shaped electric silhouette.
  const perp={x:-u.z,y:0,z:u.x};
  const pl=Math.hypot(perp.x,perp.z)||1;perp.x/=pl;perp.z/=pl;
  const up={x:-u.y*perp.z,y:u.z*perp.x-u.x*perp.z,z:u.y*perp.x};
  const ul=Math.hypot(up.x,up.y,up.z)||1;up.x/=ul;up.y/=ul;up.z/=ul;
  for(let batch=0;batch<5;batch++)system.runTimeout(()=>{
   if(!alive(b))return;
   for(let i=batch;i<=reach;i+=5){
    const cx=start.x+u.x*i,cy=start.y+u.y*i,cz=start.z+u.z*i;
    for(const r of [0,radius*.7]){
     const count=r===0?1:8;
     for(let j=0;j<count;j++){
      const ang=2*Math.PI*j/count;
      spark(dim,{x:cx+r*(perp.x*Math.cos(ang)+up.x*Math.sin(ang)),
                 y:cy+r*(perp.y*Math.cos(ang)+up.y*Math.sin(ang)),
                 z:cz+r*(perp.z*Math.cos(ang)+up.z*Math.sin(ang))},'titan_overload_beam');
     }
    }
   }
  },batch);
   safe(()=>dim.playSound('mob.warden.sonic_boom',start,{volume:2,pitch:.45}));
   F.sfx(dim,'sparkmod.titan.beam',start,5,.6);F.sfx(dim,'sparkmod.titan.explode',start,3,1.3);
   {const tip={x:start.x+u.x*Math.min(reach,length),y:start.y+u.y*Math.min(reach,length),z:start.z+u.z*Math.min(reach,length)};
    for(let k=0;k<6;k++)system.runTimeout(()=>{
     for(let s2=0;s2<=Math.min(reach,length+4);s2+=1.5)F.orb(dim,{x:start.x+u.x*s2,y:start.y+u.y*s2,z:start.z+u.z*s2},radius*.9,k%2?F.C.white:F.C.cyan,.12,.75);
     F.arc(dim,start,tip,{color:F.C.white,size:.45,jag:2,branches:2,max:180});
    },k*2);
    F.flash(dim,start,8,F.C.cyan);F.flash(dim,tip,10,F.C.cyan);F.shock(dim,tip,radius*2,F.C.cyan,.8);
    F.debris(dim,tip,3,40);F.sparks(dim,tip,60,12,F.C.cyan);F.shake(dim,start,60,2.2,1.0);}
   const hitIds=new Set();
   if(length<=reach+radius && hit(b,target,big?70:48))hitIds.add(target.id);
   for(const enemy of targets(b,reach+radius+5)){
    if(hitIds.has(enemy.id))continue;
   const v={x:enemy.location.x-start.x,y:enemy.location.y+1-start.y,z:enemy.location.z-start.z};
   const along=v.x*u.x+v.y*u.y+v.z*u.z;
   const off=Math.max(0,v.x*v.x+v.y*v.y+v.z*v.z-along*along);
   if(along>=-1 && along<=reach && off<=(radius+1.5)**2){
    hit(b,enemy,big?70:48);
    safe(()=>enemy.applyKnockback({x:u.x*1.6,z:u.z*1.6},.25));
   }
  }
 });
 return true;
}


// Spark Cannon: launches a visible tracking orb at the current locked target.
// Deals five hearts (10 health points) of base damage and stuns players for 3 seconds.
const SPARK_CANNON_COOLDOWN=180; // 9 seconds
function sparkCannon(b){
 const target=combatTarget(b);
 if(!isTarget(target))return false;
 if(system.currentTick<(cannonCooldown.get(b.id)||0))return false;
 if(Math.sqrt(dist(b.location,target.location))>46)return false;
 cannonCooldown.set(b.id,system.currentTick+SPARK_CANNON_COOLDOWN);
 beginAbilityCast(b,22);
 faceEnemy(b,target);
 const dim=b.dimension;
 const origin={x:b.location.x,y:b.location.y+(b.typeId===GIANT?2.9:2.6),z:b.location.z};
 safe(()=>dim.playSound('mob.warden.sonic_charge',origin,{pitch:1.5,volume:1.6}));
 F.sfx(dim,'sparkmod.titan.charge',origin,2,1.6);
 for(let t=0;t<10;t+=2)later(b,t,()=>{const c=F.core(b);F.converge(dim,c,2,8,F.C.orange);F.orb(dim,c,.4+t*.08,F.C.orange,.15);});
 empoweredRing(dim,origin,1.2,20,'orange_star');
 // A delayed throw creates a readable wind-up rather than instant invisible damage.
 later(b,10,()=>{
  if(!isTarget(target) || target.dimension.id!==dim.id)return;
  const pos={x:b.location.x,y:b.location.y+(b.typeId===GIANT?3.1:2.7),z:b.location.z};
  F.sfx(dim,'sparkmod.titan.cannon',pos,2.5,1);F.flash(dim,pos,3,F.C.orange);
  let age=0;
  const travel=()=>safe(()=>{
   if(!alive(b)||!isTarget(target)||target.dimension.id!==dim.id)return;
   if(++age>52)return;
   const to={x:target.location.x,y:target.location.y+1.05,z:target.location.z};
   const dx=to.x-pos.x,dy=to.y-pos.y,dz=to.z-pos.z;
   const gap=Math.hypot(dx,dy,dz);
   const step=Math.min(1.8,gap);
   if(gap>.001){pos.x+=dx/gap*step;pos.y+=dy/gap*step;pos.z+=dz/gap*step;}
   // Glowing orb and contrasting spark trail from the user's V198 particles.
   spark(dim,{...pos},'orange_star');
   spark(dim,{x:pos.x+.22,y:pos.y,z:pos.z},'ice_diamond');
   F.orb(dim,{...pos},1.3,F.C.orange,.12);F.orb(dim,{...pos},.6,F.C.white,.12);
   if(age%2===0)F.arc(dim,{...pos},{x:pos.x-dx/(gap||1)*2+(Math.random()-.5),y:pos.y-dy/(gap||1)*2+(Math.random()-.5),z:pos.z-dz/(gap||1)*2+(Math.random()-.5)},{color:F.C.cyan,size:.16,branches:0,max:16});
   if(age%6===0)F.sfx(dim,'sparkmod.titan.zap',pos,.8,1.6);
   if(age%4===0)empoweredRing(dim,pos,.55,8,'boom_ring_blue');
   if(gap<=2.2 || Math.hypot(to.x-pos.x,to.y-pos.y,to.z-pos.z)<1.2){
    if(Math.sqrt(dist(b.location,target.location))<=50 && hit(b,target,10)){
     if(target.typeId==='minecraft:player')safe(()=>stun(target,3));
     else safe(()=>target.addEffect('slowness',60,{amplifier:10,showParticles:false}));
     empoweredRing(dim,pos,2.2,24,'orange_star');
     safe(()=>dim.playSound('random.explode',pos,{volume:1.4,pitch:1.25}));
     F.sfx(dim,'sparkmod.titan.impact',pos,2,1.3);F.flash(dim,pos,4,F.C.orange);
     F.sparks(dim,pos,36,8,F.C.orange);F.pulse(dim,pos,4,F.C.orange,.35);F.shake(dim,pos,10,.7,.4);
    }
    return;
   }
   system.runTimeout(travel,1);
  });
  travel();
 });
 return true;
}

// 3. Spark Downslam: small upward impulse followed by a ground shockwave.
function downslam(b,big){
 beginAbilityCast(b,26);
 safe(()=>b.applyImpulse({x:0,y:.65,z:0}));const radius=(big?22:13)*powerScale(b)*damageScale;
 {const d=b.dimension;F.warn(d,b.location,radius,24,F.C.red);F.sfx(d,'sparkmod.titan.charge',F.core(b),2,.6);
  F.debris(d,b.location,2,16);F.smoke(d,b.location,6,1.2,F.C.dust,.7);
  for(let t=4;t<24;t+=4)later(b,t,()=>{F.motes(d,F.core(b),1.2,8,F.C.gold);F.arc(d,F.core(b),{x:b.location.x+(Math.random()-.5)*radius,y:b.location.y-2,z:b.location.z+(Math.random()-.5)*radius},{color:F.C.gold,size:.22,branches:0,max:50});});}
 later(b,24,()=>{
  const at={...b.location},d=b.dimension;empoweredRing(d,at,radius,48);safe(()=>d.playSound('random.explode',at));
  F.sfx(d,'sparkmod.titan.slam',at,4,big?.75:1);
  splash(b,at,radius,big?32:18,true);
  F.shock(d,at,radius,F.C.gold,.7);
  system.runTimeout(()=>F.shock(d,at,radius*.7,F.C.cyan,.6),3);
  system.runTimeout(()=>F.shock(d,at,radius*1.1,F.C.white,.9),6);
  F.flash(d,{x:at.x,y:at.y+.5,z:at.z},5,F.C.gold);
  F.debris(d,at,3,50);F.sparks(d,{x:at.x,y:at.y+.3,z:at.z},50,10,F.C.gold);
  for(let i=0;i<8;i++){const a=i*Math.PI/4,r=radius*(.45+Math.random()*.4);
   const q={x:at.x+Math.cos(a)*r,y:at.y,z:at.z+Math.sin(a)*r};
   system.runTimeout(()=>{F.debris(d,q,1.5,10);F.smoke(d,q,3,1,F.C.dust,.6);},Math.floor(r/3));
   F.arc(d,{x:at.x,y:at.y+.2,z:at.z},{x:q.x,y:F.groundY(d,q)+.1,z:q.z},{color:F.C.gold,size:.25,jag:.5,branches:0});}
  F.shake(d,at,radius*2,1.8,.9);
 });
}
// 4. Scream affects every online survival/adventure player, as requested.
function scream(b,big){
 beginAbilityCast(b,20);
 beginScreamRage(b);
 safe(()=>b.dimension.playSound('mob.warden.roar',b.location,{volume:2,pitch:big?.7:1}));empoweredRing(b.dimension,b.location,big?12:6);
 {const d=b.dimension,c=F.core(b),col=big?F.C.purple:F.C.red;
  F.sfx(d,'sparkmod.titan.roar',c,5,big?.8:1);
  for(let k=0;k<5;k++)system.runTimeout(()=>{if(!alive(b))return;const h=F.core(b);F.pulse(d,h,(big?14:9)+k*3,k%2?F.C.white:col,.6);F.motes(d,h,1.5,10,col);},k*4);
  F.shock(d,b.location,big?18:11,col,.9);F.smoke(d,b.location,8,1.5,F.C.dust,.6);
  F.shake(d,c,48,1.4,1.6);}
 splash(b,b.location,big?18:11,big?14:8);
 for(const p of world.getAllPlayers().filter(isTarget)){
  safe(()=>p.addEffect('weakness',big?240:160,{amplifier:big?1:0,showParticles:false}));
  safe(()=>p.addEffect('nausea',big?240:160,{amplifier:0,showParticles:false}));
 }
}
// Persist scheduled death transitions before the dying entity is removed.
function queueTransition(b,type){
 const jobs=read(world,PENDING,{});
 jobs[b.id]={type,dimension:b.dimension.id,location:{...b.location},rank:read(b,RANK,{})};
 world.setDynamicProperty(PENDING,JSON.stringify(jobs));
}
function transitions(){
 const jobs=read(world,PENDING,{});
 if(defeated()){if(Object.keys(jobs).length)world.setDynamicProperty(PENDING,undefined);return;}
 for(const [id,j] of Object.entries(jobs))safe(()=>{
  const dim=world.getDimension(j.dimension);
  if(!dim.getBlock({x:Math.floor(j.location.x),y:Math.floor(j.location.y),z:Math.floor(j.location.z)}))return;
  const key='sparkmod:transition:'+id;
  let e=dim.getEntities({type:j.type}).find(e=>e.hasTag(key));
  if(!e){e=dim.spawnEntity(j.type,j.location);e.addTag(key);e.setDynamicProperty(RANK,JSON.stringify(j.rank));e.setDynamicProperty('sparkmod:host_after',Date.now()+5000);}
  delete jobs[id];world.setDynamicProperty(PENDING,JSON.stringify(jobs));
 });
}
// V217 possession: the Spark Demon hunts the nearest mob OR survival player.
// While the possession ritual runs (3 seconds) the host cannot be killed or hurt.
const HOST_TAG='sparkmod:possessing';
const POSSESS_TICKS=60;
const possessions=new Map(); // demonId -> {hostId, done}
function findEntity(dim,id){return safe(()=>dim.getEntities({tags:[HOST_TAG]}).find(e=>e.id===id)||world.getEntity(id),null);}
function demonTick(b){
 const at=b.location,dim=b.dimension;
 const tk=system.currentTick;
 if(tk%10<2)ring(dim,{x:at.x,y:at.y+.5,z:at.z},.8,12);
 if(tk%6<2){F.motes(dim,{x:at.x,y:at.y+.7,z:at.z},.5,5,F.C.purple);F.orb(dim,{x:at.x,y:at.y+.7,z:at.z},1.4,F.C.purple,.4,.6);}
 if(tk%40<2)F.sfx(dim,'sparkmod.demon.ambient',at,1.2,.9+Math.random()*.2);
 const st=possessions.get(b.id);
 if(st){
  const host=findEntity(dim,st.hostId);
  if(!host||!safe(()=>host.isValid,false)||host.dimension.id!==dim.id){possessions.delete(b.id);return;}
  possessionTick(b,host,st);return;
 }
 if(Date.now()<Number(b.getDynamicProperty('sparkmod:host_after')||0))return;
 const host=targets(b,48)[0]; // nearest mob or survival/adventure player
 if(!host)return;
 const delta={x:host.location.x-at.x,y:host.location.y+1-at.y,z:host.location.z-at.z};const length=Math.sqrt(delta.x**2+delta.y**2+delta.z**2);
 if(length>2.2){
  const k=Math.min(1,.55/length); // ~5.5 blocks per second
  safe(()=>b.teleport({x:at.x+delta.x*k,y:at.y+delta.y*k,z:at.z+delta.z*k},{dimension:dim,facingLocation:host.location}));
  if(system.currentTick%20<2&&host.typeId==='minecraft:player')safe(()=>host.onScreenDisplay.setActionBar('§6§lThe Spark Demon is hunting YOU...'));
  return;
 }
 beginPossession(b,host);
}
function beginPossession(b,host){
 const dim=b.dimension;
 possessions.set(b.id,{hostId:host.id,start:system.currentTick});
 safe(()=>host.addTag(HOST_TAG));
 const isPlayer=host.typeId==='minecraft:player';
 const name=isPlayer?host.name:(host.typeId.split(':')[1]||'creature').replace(/_/g,' ');
 if(isPlayer){
  safe(()=>stun(host,POSSESS_TICKS/20+.5));
  safe(()=>host.onScreenDisplay.setTitle('§6§lPOSSESSED',{subtitle:'§6The Spark Demon is taking your body!',fadeInDuration:5,stayDuration:60,fadeOutDuration:15}));
 }else safe(()=>host.addEffect('slowness',POSSESS_TICKS+10,{amplifier:255,showParticles:false}));
 safe(()=>host.addEffect('levitation',POSSESS_TICKS,{amplifier:0,showParticles:false}));
 for(const p of safe(()=>dim.getPlayers({location:host.location,maxDistance:100}),[]))
  if(p.id!==host.id)safe(()=>p.onScreenDisplay.setTitle('§6§lPOSSESSION',{subtitle:'§6The Spark Demon is possessing §e'+name+'§6!',fadeInDuration:5,stayDuration:50,fadeOutDuration:15}));
 F.sfx(dim,'sparkmod.titan.possess',host.location,4,1);
 safe(()=>dim.playSound('mob.wither.ambient',host.location,{volume:2,pitch:.5}));
 F.cage(dim,host,POSSESS_TICKS,F.C.purple,1.2);
}
function possessionTick(b,host,st){
 const dim=b.dimension,age=system.currentTick-st.start,k=Math.min(1,age/POSSESS_TICKS);
 const hc={x:host.location.x,y:host.location.y+1,z:host.location.z};
 // The demon spirals inward around its host.
 const ang=age*.45,r=2.6*(1-k)+.2;
 safe(()=>b.teleport({x:hc.x+Math.cos(ang)*r,y:hc.y+.6+Math.sin(age*.3)*.4,z:hc.z+Math.sin(ang)*r},{dimension:dim}));
 if(age%4<2){F.converge(dim,hc,3-k*2,16,F.C.purple);F.orb(dim,hc,1+k*3,F.C.purple,.25,.7);}
 if(age%6<2)F.arc(dim,b.location,hc,{color:F.C.pink,size:.25,branches:1,max:50});
 if(host.typeId==='minecraft:player'&&age%20<2)safe(()=>host.runCommand('camerashake add @s 0.5 1.0 rotational'));
 if(age<POSSESS_TICKS)return;
 // Ritual complete: the Possessed Titan erupts from the host.
 possessions.delete(b.id);
 const spot={...host.location};
 const giant=safe(()=>dim.spawnEntity(GIANT,spot),null);
 if(!giant){safe(()=>host.removeTag(HOST_TAG));return;}
 safe(()=>giant.setDynamicProperty(RANK,JSON.stringify(read(b,RANK,{}))));
 F.flash(dim,hc,10,F.C.purple);F.shock(dim,spot,14,F.C.purple,1);F.sparks(dim,hc,60,10,F.C.pink);F.smoke(dim,spot,10,1.5,F.C.smoke,.8);
 F.sfx(dim,'sparkmod.titan.explode',spot,3,1.4);F.shake(dim,spot,40,1.6,1.0);
 if(host.typeId==='minecraft:player'){
  // A possessed player survives: the Titan bursts out of them and throws them clear.
  safe(()=>host.removeTag(HOST_TAG));
  safe(()=>restore(host,true));
  safe(()=>host.removeEffect('levitation'));
  const a=Math.random()*Math.PI*2;
  safe(()=>host.applyKnockback({x:Math.cos(a)*2.5,z:Math.sin(a)*2.5},.7));
  safe(()=>host.addEffect('nausea',140,{amplifier:0,showParticles:false}));
  safe(()=>host.addEffect('darkness',60,{amplifier:0,showParticles:false}));
  safe(()=>host.addEffect('slow_falling',80,{amplifier:0,showParticles:false}));
  safe(()=>host.sendMessage('§6The Possessed Titan tore its way out of your body!'));
 }else safe(()=>host.remove());
 safe(()=>b.remove());phase(giant);
}
// Possessed hosts can't be hurt or killed; clear stale tags (reload, demon gone).
world.beforeEvents.entityHurt.subscribe(ev=>{if(ev.hurtEntity?.hasTag?.(HOST_TAG))ev.cancel=true;});
system.runInterval(()=>{
 const active=new Set([...possessions.values()].map(s=>s.hostId));
 for(const name of ['overworld','nether','the_end'])
  for(const e of safe(()=>world.getDimension(name).getEntities({tags:[HOST_TAG]}),[]))
   if(!active.has(e.id))safe(()=>{e.removeTag(HOST_TAG);if(e.typeId==='minecraft:player')restore(e,true);});
},40);

system.runInterval(()=>{
 transitions();const seen=new Set();
 for(const name of ['overworld','nether','the_end']){
  const dim=world.getDimension(name);
  for(const type of TYPES)for(const b of dim.getEntities({type}))safe(()=>{
   if(removeLocked(b)||!alive(b))return;seen.add(b.id);
   if(type===DEMON)return; // ticked every 2 ticks below
   if((emergenceUntil.get(b.id)||0)>system.currentTick)return;
   aura(b);
   if(type===GIANT&&shutdownTick(b))return;
    endScreamRage(b);phase(b);wardentick(b);phaseTwoTeleport(b);scriptedMelee(b);if(overloadBeam(b))return;const s=state(b);if(system.currentTick<s.next||!combatTarget(b))return;
   const big=type===GIANT;s.next=system.currentTick+(big?50:80); // Phase 3: 2.5 s, phases 1/2: 4 s.
   const move=s.cycle++%5;
   if(move===4){if(!sparkCannon(b))sparkStun(b,big);}
   else [sparkStun,sparkBoom,downslam,scream][move](b,big);
  });
 }
 for(const id of fights.keys())if(!seen.has(id))fights.delete(id);
 for(const id of shutdowns.keys())if(!seen.has(id))shutdowns.delete(id);
 for(const id of possessions.keys())if(!seen.has(id))possessions.delete(id);
 for(const id of senses.keys())if(!seen.has(id))senses.delete(id);
 for(const id of teleportCooldown.keys())if(!seen.has(id))teleportCooldown.delete(id);
  for(const id of overloadCooldown.keys())if(!seen.has(id))overloadCooldown.delete(id);
 for(const id of swings.keys())if(!seen.has(id))swings.delete(id);
  for(const id of cannonCooldown.keys())if(!seen.has(id))cannonCooldown.delete(id);
  for(const id of emergenceUntil.keys())if(!seen.has(id))emergenceUntil.delete(id);
 for(const id of meleeCooldown.keys())if(!seen.has(id))meleeCooldown.delete(id);
 for(const key of vanillaHits.keys()){
  const bossId=key.split(':')[0];
  if(!seen.has(bossId) || system.currentTick-vanillaHits.get(key)>200)vanillaHits.delete(key);
 }
},10);
system.runInterval(()=>{
 if(defeated())return;
 for(const name of ['overworld','nether','the_end'])
  for(const d of safe(()=>world.getDimension(name).getEntities({type:DEMON}),[]))safe(()=>{if(d.isValid)demonTick(d);});
},2);

// ---------- V217: ambient electric aura ----------
function aura(b){
 const d=b.dimension,c=F.core(b),tk=system.currentTick;
 if(isShutdown(b))return;
 const raged=powerScale(b)>1,col=raged?F.C.red:b.typeId===GIANT?F.C.purple:F.C.cyan;
 F.motes(d,c,1.1*(b.typeId===GIANT?1.2:1),raged?10:5,col);
 if(tk%40<10&&Math.random()<.6){
  const g={x:c.x+(Math.random()-.5)*7,y:b.location.y,z:c.z+(Math.random()-.5)*7};
  F.arc(d,{x:c.x+(Math.random()-.5),y:c.y+(Math.random()-.3),z:c.z+(Math.random()-.5)},{x:g.x,y:F.groundY(d,g),z:g.z},{color:col,size:.2,branches:0,max:40});
  F.sfx(d,'sparkmod.titan.zap',c,.5,1.2+Math.random()*.4);
 }
}

// ---------- V217: final-phase shutdown cycle ----------
// The Possessed Titan runs for 30 s, then shuts down for 10 s (immobile, no attacks,
// takes +50% damage). When it reboots, everything within 100 blocks is stunned
// and levitated for 5 seconds.
const ACTIVE_TICKS=600,SHUTDOWN_TICKS=200,REBOOT_RADIUS=100;
const shutdowns=new Map(); // id -> {next, end}
function shutdownTick(b){
 const now=system.currentTick;
 let s=shutdowns.get(b.id);
 if(!s){
  s={next:now+ACTIVE_TICKS,end:0};shutdowns.set(b.id,s);
  // Reloaded mid-shutdown: finish it shortly.
  if(isShutdown(b)){s.end=now+40;s.next=0;}
 }
 if(s.end){ // currently shut down
  shutdownEffects(b,s.end-now);
  if(now>=s.end)reboot(b,s);
  return true;
 }
 if(now>=s.next&&!safe(()=>b.getProperty(CASTING),false)){beginShutdown(b,s);return true;}
 return false;
}
function nearbyPlayers(b,r){return safe(()=>b.dimension.getPlayers({location:b.location,maxDistance:r}),[]);}
function beginShutdown(b,s){
 const now=system.currentTick;
 s.end=now+SHUTDOWN_TICKS;
 casts.delete(b.id);
 safe(()=>b.setProperty(CASTING,false));safe(()=>b.setProperty('sparkmod:attacking',false));
 safe(()=>b.setProperty(SHUT,true));safe(()=>b.triggerEvent('sparkmod:shutdown_on'));
 const d=b.dimension,c=F.core(b);
 F.sfx(d,'sparkmod.titan.shutdown',c,5,1);
 safe(()=>d.playSound('mob.irongolem.death',c,{volume:2,pitch:.5}));
 F.sparks(d,c,60,8,F.C.gold);F.smoke(d,c,12,1.5);F.flash(d,c,5,F.C.cyan);F.shake(d,c,30,.8,.6);
 for(const p of nearbyPlayers(b,REBOOT_RADIUS))
  safe(()=>p.onScreenDisplay.setTitle('§6§lSHUT DOWN',{subtitle:'§eIts core is exposed — §ehit it now!',fadeInDuration:5,stayDuration:40,fadeOutDuration:10}));
}
function shutdownEffects(b,left){
 const d=b.dimension,c=F.core(b);
 // Every 10 ticks (main loop rate): smoke, sputtering sparks, countdown.
 F.smoke(d,{x:c.x,y:c.y+1,z:c.z},3,1);
 if(Math.random()<.5){F.sparks(d,{x:c.x+(Math.random()-.5)*1.5,y:c.y+(Math.random()-.3)*2,z:c.z+(Math.random()-.5)*1.5},10,4,F.C.gold);F.sfx(d,'sparkmod.titan.zap',c,.6,.6);}
 const secs=Math.ceil(left/20);
 if(left%20<10){
  F.sfx(d,secs<=3?'sparkmod.titan.beep':'sparkmod.titan.hum',c,secs<=3?2:1.2,secs<=3?1+(3-secs)*.15:1);
  for(const p of nearbyPlayers(b,REBOOT_RADIUS))safe(()=>p.onScreenDisplay.setActionBar((secs<=3?'§6§l':'§6')+'⚡ REBOOTING IN '+secs+'...'));
 }
 if(left<=40&&left>30)F.sfx(d,'sparkmod.titan.reboot',c,6,1);
 if(left<=50){
  F.converge(d,c,8,30,F.C.purple);F.orb(d,c,2+(50-left)/10,F.C.purple,.5);
  F.arc(d,{x:c.x+(Math.random()-.5)*16,y:b.location.y,z:c.z+(Math.random()-.5)*16},c,{color:F.C.purple,size:.3,branches:1,max:60});
  F.warn(d,b.location,12,10,F.C.purple);
 }
}
function reboot(b,s){
 const now=system.currentTick;
 s.end=0;s.next=now+ACTIVE_TICKS;
 safe(()=>b.setProperty(SHUT,false));safe(()=>b.triggerEvent('sparkmod:shutdown_off'));
 // Make sure walking speed came back when the shutdown group was removed.
 system.runTimeout(()=>safe(()=>{const m=b.getComponent('minecraft:movement');if(m&&m.currentValue<.01)m.setCurrentValue(powerScale(b)>1?.45:.3);}),2);
 const st=state(b);st.next=now+30; // short grace before its next ability
 const d=b.dimension,c=F.core(b);
 safe(()=>d.playSound('mob.warden.roar',c,{volume:3,pitch:.6}));
 F.sfx(d,'sparkmod.titan.explode',c,6,1.2);
 F.flash(d,c,14,F.C.purple);F.flash(d,c,8,F.C.white);
 for(let k=0;k<4;k++)system.runTimeout(()=>{F.shock(d,b.location,20+k*25,k%2?F.C.white:F.C.purple,1.2);F.pulse(d,c,10+k*8,F.C.purple,.7);},k*3);
 F.sparks(d,c,80,14,F.C.purple);F.debris(d,b.location,4,50);
 F.shake(d,c,REBOOT_RADIUS,2.0,1.5);
 const victims=safe(()=>d.getEntities({location:b.location,maxDistance:REBOOT_RADIUS}),[]).filter(isTarget);
 let i=0;
 for(const v of victims){
  const idx=i++;
  const delay=Math.min(20,Math.floor(Math.sqrt(dist(v.location,b.location))/6))+(idx%3);
  system.runTimeout(()=>safe(()=>{
   if(!isTarget(v))return;
   const to={x:v.location.x,y:v.location.y+1,z:v.location.z};
   if(idx<12)F.bolt(d,F.core(b),to,{color:F.C.purple,size:.35,branches:1,max:120},4);
   F.flash(d,to,2.5,F.C.purple);F.sparks(d,to,16,5,F.C.pink);
   F.sfx(d,'sparkmod.titan.zap',to,1.5,.8);
   if(v.typeId==='minecraft:player'){
    stun(v,5);
    safe(()=>v.onScreenDisplay.setTitle('§6§lSTUNNED',{subtitle:'§eThe Titan rebooted!',fadeInDuration:2,stayDuration:80,fadeOutDuration:10}));
   }else safe(()=>v.addEffect('slowness',100,{amplifier:255,showParticles:false}));
   safe(()=>v.addEffect('levitation',100,{amplifier:0,showParticles:true}));
   F.cage(d,v,100,F.C.purple);
  }),delay);
 }
}
// Shut-down Titans can't melee and take 50% more damage.
world.beforeEvents.entityHurt.subscribe(ev=>{
 const a=ev.damageSource?.damagingEntity;
 if(a?.typeId===GIANT&&isShutdown(a)){ev.cancel=true;return;}
 if(ev.hurtEntity?.typeId===GIANT&&isShutdown(ev.hurtEntity))ev.damage*=1.5;
});
// Impact effects on every Titan melee hit.
world.afterEvents.entityHurt.subscribe(({hurtEntity,damageSource})=>safe(()=>{
 const a=damageSource?.damagingEntity;
 if(![BASE,GIANT].includes(a?.typeId)||damageSource.cause!=='entityAttack'||!hurtEntity.isValid)return;
 const d=hurtEntity.dimension,p={x:hurtEntity.location.x,y:hurtEntity.location.y+1,z:hurtEntity.location.z};
 F.sparks(d,p,24,6,F.C.gold);F.flash(d,p,2.2,a.typeId===GIANT?F.C.purple:F.C.cyan);
 F.sfx(d,'sparkmod.titan.zap',p,1.4,.9);F.sfx(d,'sparkmod.titan.impact',p,1,1.4);
 if(hurtEntity.typeId==='minecraft:player')safe(()=>hurtEntity.runCommand('camerashake add @s 0.6 0.3 positional'));
},undefined));

world.afterEvents.entityDie.subscribe(e=>{
 const b=e.deadEntity;if(!TYPES.includes(b.typeId))return;
 safe(()=>{
  fights.delete(b.id);if(defeated())return;
  if(b.typeId!==GIANT){queueTransition(b,DEMON);return;}
  // Fifth move only advances the first body to phase 3; the final body can be defeated.
  world.setDynamicProperty(LOCK,true);world.setDynamicProperty(PENDING,undefined);
  for(const p of world.getAllPlayers())safe(()=>restore(p,true));
  // V216: loot appears after the 5-second Ender Dragon-style death show (titan_boss_v216.js).
  const dim=b.dimension,at={...b.location},rank=read(b,RANK,{});
  system.runTimeout(()=>safe(()=>{
   dim.spawnItem(new ItemStack('sparkmod:sparkite',6),at);
   dim.spawnItem(new ItemStack('sparkmod:spark_token',7),at);
   ring(dim,at,10,48);
   const winner=Object.entries(rank).sort((a,c)=>c[1]-a[1])[0]?.[0];
   if(winner&&Math.random()<.05){
    const p=world.getAllPlayers().find(p=>p.name===winner),mace=new ItemStack('minecraft:mace',1);
    mace.nameTag='§6Spark Mace';mace.setLore(['§8SparkMod: genuine vanilla mace']);
    const inv=p?.getComponent('minecraft:inventory')?.container;const rest=inv?inv.addItem(mace):mace;
    if(rest)dim.spawnItem(rest,p?.location||at);
   }
  }),100);
 });
});


const SUMMONED='sparkmod:colosseum_titan';
world.afterEvents.entitySpawn.subscribe(({entity})=>{
 if(entity.typeId!==BASE)return;
 system.runTimeout(()=>{
  if(!entity.isValid)return;
  if(!entity.hasTag(SUMMONED))entity.remove();
 },2);
});

// Use /scriptevent sparkmod:titan_debug to inspect the boss target and attack state.
system.afterEvents.scriptEventReceive.subscribe(ev=>{
 if(ev.id!=='sparkmod:titan_debug')return;
 system.run(()=>safe(()=>{
  const sender=ev.sourceEntity;
  const dim=sender?.dimension||world.getDimension('overworld');
  const bosses=dim.getEntities().filter(e=>[BASE,GIANT].includes(e.typeId));
  const messages=[];
  for(const b of bosses.slice(0,5)){
   const t=combatTarget(b);
   const distance=t?Math.sqrt(dist(t.location,b.location)).toFixed(1):'none';
   const melee=Math.max(0,(meleeCooldown.get(b.id)||0)-system.currentTick)/20;
   const ability=Math.max(0,(fights.get(b.id)?.next||0)-system.currentTick)/20;
   messages.push('Bolt Titan '+b.typeId+': target='+(t?.typeId||'NONE')+' distance='+distance+' range='+meleeReach(b).toFixed(1)+' melee='+melee.toFixed(1)+'s ability='+ability.toFixed(1)+'s');
  }
  if(!messages.length)messages.push('No Bolt Titan in this dimension.');
  for(const line of messages){if(sender?.typeId==='minecraft:player')sender.sendMessage('§6[Spark AI] §e'+line);else world.sendMessage('§6[Spark AI] §e'+line);}
 }));
});


// Warden-inspired spawn emergence, 50 real Minecraft lightning bolts in 5 seconds.
const EMERGENCE_TICKS=102;
function spawningBoltTitan(b){
 if(![BASE,GIANT].includes(b.typeId))return;
 // Respect the existing once-only Colosseum summon restriction and death lock.
 system.runTimeout(()=>safe(()=>{
  if(!alive(b)||defeated())return;
  if(b.typeId===BASE && !b.hasTag('sparkmod:colosseum_titan'))return;
  emergenceUntil.set(b.id,system.currentTick+EMERGENCE_TICKS);
  b.setProperty('sparkmod:emerging',true);
  b.triggerEvent('sparkmod:emergence_on');
  const dim=b.dimension;
  const at={...b.location};
  safe(()=>dim.playSound('mob.warden.emerge',at,{volume:2,pitch:.75}));
  F.sfx(dim,'sparkmod.titan.charge_long',at,5,.6);
  F.warn(dim,at,6,EMERGENCE_TICKS,b.typeId===GIANT?F.C.purple:F.C.gold);
  for(let t=0;t<EMERGENCE_TICKS;t+=6)system.runTimeout(()=>safe(()=>{
   if(!alive(b))return;
   F.debris(dim,at,2.5,10);F.smoke(dim,at,3,1.6,F.C.dust,.6);
   if(t%18===0){F.sfx(dim,'sparkmod.titan.slam',at,2,.6+t/EMERGENCE_TICKS*.4);F.shake(dim,at,30,.5+t/EMERGENCE_TICKS,.4);}
  }),t);
  for(let strike=0;strike<50;strike++){
   system.runTimeout(()=>safe(()=>{
    if(!alive(b))return;
    const targetsNearby=dim.getEntities({location:at,maxDistance:23}).filter(e=>isTarget(e));
    const ps=targetsNearby.filter(e=>e.typeId==='minecraft:player');
    const mobs=targetsNearby.filter(e=>e.typeId!=='minecraft:player');
    let p;
    if(strike%3===0 && ps.length){p=ps[strike%ps.length].location;}
    else if(strike%3===1 && mobs.length){p=mobs[strike%mobs.length].location;}
    else {
      // Random ground within a 22-block radius of the spawn point.
      const angle=Math.random()*Math.PI*2;
      const r=5+Math.sqrt(Math.random())*17;
      const x=at.x+Math.cos(angle)*r,z=at.z+Math.sin(angle)*r;
      let y=at.y;
      // Search locally for a solid block without requesting unloaded chunks.
      for(let dy=6;dy>=-7;dy--){
       const candidate=dim.getBlock({x:Math.floor(x),y:Math.floor(at.y)+dy,z:Math.floor(z)});
       if(!candidate)break;
       if(!candidate.isAir && !candidate.isLiquid){y=candidate.location.y+1;break;}
      }
      p={x,y,z};
    }
    // These are genuine game lightning entities, not just visual particles.
     recordTitanLightning(dim,{x:p.x,y:p.y+0.1,z:p.z});
     dim.spawnEntity('minecraft:lightning_bolt',{x:p.x,y:p.y+0.1,z:p.z});
    empoweredSpark(dim,{x:p.x,y:p.y+1.5,z:p.z},'spark_shockwave');
    if(strike%4===0){F.shock(dim,p,3,F.C.cyan,.5);F.sparks(dim,{x:p.x,y:p.y+.3,z:p.z},14,6,F.C.cyan);}
    if(strike%8===0)empoweredRing(dim,at,2.4+strike*.04,16,'boom_ring_blue');
   }),strike*2);
  }
  system.runTimeout(()=>safe(()=>{
   if(!alive(b))return;
   b.setProperty('sparkmod:emerging',false);
   b.triggerEvent('sparkmod:emergence_off');
   F.sfx(dim,'sparkmod.titan.roar',b.location,6,b.typeId===GIANT?.75:.95);
   F.flash(dim,F.core(b),8,b.typeId===GIANT?F.C.purple:F.C.gold);F.shock(dim,b.location,14,F.C.white,1);F.debris(dim,b.location,3,40);
   emergenceUntil.delete(b.id);
  }),EMERGENCE_TICKS);
 }),3);
}
world.afterEvents.entitySpawn.subscribe(({entity})=>{
 if([BASE,GIANT].includes(entity.typeId))spawningBoltTitan(entity);
});

