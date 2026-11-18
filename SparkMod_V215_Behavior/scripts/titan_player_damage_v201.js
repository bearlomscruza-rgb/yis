import { world, system } from '@minecraft/server';

// V201 damage balance: halves Bolt Titan damage to PLAYERS ONLY.
// Do not change native attack stats: animals/monsters retain original damage.
const TITANS = new Set(['sparkmod:bolt_titan', 'sparkmod:bolt_titan_phase3']);
const LIGHTNING_STRIKES = [];
const LIGHTNING_PROXIMITY_SQUARED = 4 * 4;

// Lightning spawned by the Titan's emergence is an independent vanilla entity,
// so its damageSource does not identify the Titan as the attacker.
// Track just those strikes so natural lightning is unaffected.
export function recordTitanLightning(dimension, location) {
 const dimId = typeof dimension === 'string' ? dimension : dimension.id;
 LIGHTNING_STRIKES.push({dimension:dimId, x:location.x, y:location.y, z:location.z, expires:system.currentTick+10});
 if (LIGHTNING_STRIKES.length > 120) LIGHTNING_STRIKES.splice(0,LIGHTNING_STRIKES.length-120);
}

function isTitanDamageToPlayer(ev) {
 if (ev.hurtEntity?.typeId !== 'minecraft:player') return false;
 const attacker=ev.damageSource?.damagingEntity;
 if (TITANS.has(attacker?.typeId)) return true;
 if (ev.damageSource?.cause !== 'lightning') return false;
 const p=ev.hurtEntity.location;
 const dimension=ev.hurtEntity.dimension.id;
 return LIGHTNING_STRIKES.some(s=>s.dimension===dimension && s.expires>=system.currentTick &&
   (p.x-s.x)*(p.x-s.x)+(p.z-s.z)*(p.z-s.z)<=LIGHTNING_PROXIMITY_SQUARED && Math.abs(p.y-s.y)<8);
}

world.beforeEvents.entityHurt.subscribe(ev=>{
 if (isTitanDamageToPlayer(ev)) ev.damage *= 0.5;
});

system.runInterval(()=>{
 const tick=system.currentTick;
 for(let i=LIGHTNING_STRIKES.length-1;i>=0;i--)
  if(LIGHTNING_STRIKES[i].expires<tick)LIGHTNING_STRIKES.splice(i,1);
},40);
