import {world,system,ItemStack,InputPermissionCategory} from '@minecraft/server';
import {recordTitanLightning} from './titan_player_damage_v201.js';
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
 safe(()=>b.teleport(p,{dimension:dim,facingLocation:t.location,checkForBlocks:true}));
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
function later(b,t,fn){system.runTimeout(()=>safe(()=>{if(!defeated()&&alive(b))fn();}),t);}
function removeLocked(e){if(TYPES.includes(e.typeId)&&defeated()){fights.delete(e.id);e.remove();return true;}return false;}
world.afterEvents.entitySpawn.subscribe(({entity})=>safe(()=>removeLocked(entity)));
// Store the old input setting on the player, so a disconnect/restart cannot strand them.
function stun(p,seconds){
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
function sparkStun(b,big){beginAbilityCast(b,12);const p=combatTarget(b);if(!p)return;empoweredRing(p.dimension,p.location,(big?5:3)*damageScale);if(p.typeId==='minecraft:player')stun(p,(big?4:3)*powerScale(b));hit(b,p,big?12:7);splash(b,p.location,(big?9:6)*damageScale,big?9:5);}
// 2. Spark Boom: fixed, telegraphed yellow sonic beam, including through walls.
function sparkBoom(b,big){
 const initial=combatTarget(b);if(!initial)return;
 beginAbilityCast(b,27);
 const d=b.dimension;
 safe(()=>d.playSound('mob.warden.sonic_charge',b.location));
 empoweredRing(d,initial.location,1.5);
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
  enhancedSonicBeam(d,o,u,reach,big);
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
 empoweredRing(dim,origin,1.2,20,'orange_star');
 // A delayed throw creates a readable wind-up rather than instant invisible damage.
 later(b,10,()=>{
  if(!isTarget(target) || target.dimension.id!==dim.id)return;
  const pos={x:b.location.x,y:b.location.y+(b.typeId===GIANT?3.1:2.7),z:b.location.z};
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
   if(age%4===0)empoweredRing(dim,pos,.55,8,'boom_ring_blue');
   if(gap<=2.2 || Math.hypot(to.x-pos.x,to.y-pos.y,to.z-pos.z)<1.2){
    if(Math.sqrt(dist(b.location,target.location))<=50 && hit(b,target,10)){
     if(target.typeId==='minecraft:player')safe(()=>stun(target,3));
     else safe(()=>target.addEffect('slowness',60,{amplifier:10,showParticles:false}));
     empoweredRing(dim,pos,2.2,24,'orange_star');
     safe(()=>dim.playSound('random.explode',pos,{volume:1.4,pitch:1.25}));
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
 later(b,24,()=>{
  const at={...b.location};empoweredRing(b.dimension,at,radius,48);safe(()=>b.dimension.playSound('random.explode',at));
  splash(b,at,radius,big?32:18,true);
  for(let r=3;r<radius;r+=3)empoweredRing(b.dimension,at,r,24);
 });
}
// 4. Scream affects every online survival/adventure player, as requested.
function scream(b,big){
 beginAbilityCast(b,20);
 beginScreamRage(b);
 safe(()=>b.dimension.playSound('mob.warden.roar',b.location,{volume:2,pitch:big?.7:1}));empoweredRing(b.dimension,b.location,big?12:6);
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
function demonTick(b){
 const at=b.location;
 ring(b.dimension,{x:at.x,y:at.y+.5,z:at.z},.8,12);
 if(Date.now()<Number(b.getDynamicProperty('sparkmod:host_after')||0))return;
 const host=targets(b,32).find(e=>e.typeId!=='minecraft:player');
 if(!host)return;
 const delta={x:host.location.x-at.x,y:host.location.y+1-at.y,z:host.location.z-at.z};const length=Math.sqrt(delta.x**2+delta.y**2+delta.z**2);
 if(length>2){const k=Math.min(1,1.5/length);b.teleport({x:at.x+delta.x*k,y:at.y+delta.y*k,z:at.z+delta.z*k},{dimension:b.dimension});return;}
 // Only consume the host after its replacement has spawned successfully.
 const giant=b.dimension.spawnEntity(GIANT,{...host.location});giant.setDynamicProperty(RANK,JSON.stringify(read(b,RANK,{})));
 host.remove();b.remove();phase(giant);
}
system.runInterval(()=>{
 transitions();const seen=new Set();
 for(const name of ['overworld','nether','the_end']){
  const dim=world.getDimension(name);
  for(const type of TYPES)for(const b of dim.getEntities({type}))safe(()=>{
   if(removeLocked(b)||!alive(b))return;seen.add(b.id);
   if(type===DEMON){demonTick(b);return;}
   if((emergenceUntil.get(b.id)||0)>system.currentTick)return;
    endScreamRage(b);phase(b);wardentick(b);phaseTwoTeleport(b);scriptedMelee(b);if(overloadBeam(b))return;const s=state(b);if(system.currentTick<s.next||!combatTarget(b))return;
   const big=type===GIANT;s.next=system.currentTick+(big?50:80); // Phase 3: 2.5 s, phases 1/2: 4 s.
   const move=s.cycle++%5;
   if(move===4){if(!sparkCannon(b))sparkStun(b,big);}
   else [sparkStun,sparkBoom,downslam,scream][move](b,big);
  });
 }
 for(const id of fights.keys())if(!seen.has(id))fights.delete(id);
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
world.afterEvents.entityDie.subscribe(e=>{
 const b=e.deadEntity;if(!TYPES.includes(b.typeId))return;
 safe(()=>{
  fights.delete(b.id);if(defeated())return;
  if(b.typeId!==GIANT){queueTransition(b,DEMON);return;}
  // Fifth move only advances the first body to phase 3; the final body can be defeated.
  world.setDynamicProperty(LOCK,true);world.setDynamicProperty(PENDING,undefined);
  for(const p of world.getAllPlayers())safe(()=>restore(p,true));
  b.dimension.spawnItem(new ItemStack('sparkmod:sparkite',6),b.location);
  b.dimension.spawnItem(new ItemStack('sparkmod:spark_token',7),b.location);
  ring(b.dimension,b.location,10,48);
  const winner=Object.entries(read(b,RANK,{})).sort((a,c)=>c[1]-a[1])[0]?.[0];
  if(winner&&Math.random()<.05){
   const p=world.getAllPlayers().find(p=>p.name===winner),mace=new ItemStack('minecraft:mace',1);
   mace.nameTag='§6Spark Mace';mace.setLore(['§8SparkMod: genuine vanilla mace']);
   const inv=p?.getComponent('minecraft:inventory')?.container;const rest=inv?inv.addItem(mace):mace;
   if(rest)b.dimension.spawnItem(rest,p?.location||b.location);
  }
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
  for(const line of messages){if(sender?.typeId==='minecraft:player')sender.sendMessage('§6[Spark AI] §f'+line);else world.sendMessage('§6[Spark AI] §f'+line);}
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
    if(strike%8===0)empoweredRing(dim,at,2.4+strike*.04,16,'boom_ring_blue');
   }),strike*2);
  }
  system.runTimeout(()=>safe(()=>{
   if(!alive(b))return;
   b.setProperty('sparkmod:emerging',false);
   b.triggerEvent('sparkmod:emergence_off');
   emergenceUntil.delete(b.id);
  }),EMERGENCE_TICKS);
 }),3);
}
world.afterEvents.entitySpawn.subscribe(({entity})=>{
 if([BASE,GIANT].includes(entity.typeId))spawningBoltTitan(entity);
});

