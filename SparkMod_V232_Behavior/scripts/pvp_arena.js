import {terrainTop} from './terrain_v184.js';
// SparkMod V167: Player-provided underground PvP arena.
// Uploaded build: 35 X by 50 Y by 35 Z, with its rim/grass at local Y=49.
// Its top rim is aligned with natural terrain at world X=2000, Z=1500.
// This does not change the Colosseum of Prizes at (1750, 1500).
import { world, system } from '@minecraft/server';

const X=2000, Z=1500;
const W=35, H=50, D=35;
const RIM_LOCAL_Y=49;
const ORIGIN_X=X-17, ORIGIN_Z=Z-17;
const STRUCTURE='sparkmod:underground_pvp_arena';
const PLACED='sparkmod:underground_pvp_arena_v167_placed';
const SURFACE='sparkmod:underground_pvp_arena_v167_surface_y';
let completed=false;
let retryTick=0;
let lastWarning=-5000;

function report(message) {
  if (system.currentTick-lastWarning<1200) return;
  lastWarning=system.currentTick;
  console.warn('[SparkMod Underground Arena] '+String(message));
}
function terrainLevel(dim,x,z) {
  const top=terrainTop(dim,{x,z});
  if (!top) return undefined;
  let y=top.location.y;
  // Ignore tall plants, leaves, water and trees when aligning the surface.
  for (let i=0; i<30; i++,y--) {
    const b=dim.getBlock({x,y,z});
    if (!b) return undefined;
    if (/leaves|log|wood|snow_layer|tallgrass|tall_grass|flower|grass$|vine|water|lava|mushroom|bamboo|seagrass|kelp/.test(b.typeId)) continue;
    return y;
  }
  return top.location.y;
}
function terrainMedian(dim) {
  // Sampling outside the pit prevents the empty centre from skewing the Y level.
  const points=[[X-22,Z],[X+22,Z],[X,Z-22],[X,Z+22],[X-22,Z-22],[X+22,Z+22]];
  const levels=[];
  for (const [x,z] of points) {
    const y=terrainLevel(dim,x,z);
    if (Number.isFinite(y)) levels.push(y);
  }
  if (levels.length<4) return undefined;
  levels.sort((a,b)=>a-b);
  return Math.round((levels[Math.floor((levels.length-1)/2)]+levels[Math.floor(levels.length/2)])/2);
}
function nearby(dim) {
  return dim.getPlayers().some(p => {
    const dx=p.location.x-X, dz=p.location.z-Z;
    return dx*dx+dz*dz<45*45;
  });
}
function chunksReady(dim, y) {
  const points=[[-1,-1],[-1,D],[W,-1],[W,D],[17,17]];
  return points.every(([dx,dz]) => {
    try { return Boolean(dim.getBlock({x:ORIGIN_X+dx,y,z:ORIGIN_Z+dz})); }
    catch { return false; }
  });
}
function createArena() {
  if (completed || system.currentTick<retryTick) return;
  try {
    if (world.getDynamicProperty(PLACED)===true) {completed=true;return;}
    const dim=world.getDimension('overworld');
    if (!nearby(dim)) return;
    const surfaceY=terrainMedian(dim);
    if (!Number.isFinite(surfaceY)) return;
    // Structure requires 50 vertical blocks from the floor to the surface.
    const baseY=Math.max(-64,Math.min(270,surfaceY-RIM_LOCAL_Y));
    if (!chunksReady(dim,baseY+25)) return;
    const location={x:ORIGIN_X,y:baseY,z:ORIGIN_Z};
    for (const player of dim.getPlayers()) {
      const dx=player.location.x-X, dz=player.location.z-Z;
      if (dx*dx+dz*dz<75*75)
        player.sendMessage('§6⚔ [SparkMod] Building the new Underground PvP Arena at X:2000, Z:1500. Move clear while it generates!');
    }
    world.structureManager.place(STRUCTURE,dim,location);
    if(!dim.getBlock({x:ORIGIN_X+17,y:baseY+RIM_LOCAL_Y,z:ORIGIN_Z+17}))
      throw Error('Arena placement verification failed');
    world.setDynamicProperty(SURFACE,baseY+RIM_LOCAL_Y);
    world.setDynamicProperty(PLACED,true);
    completed=true;
    for (const player of dim.getPlayers()) {
      const dx=player.location.x-X, dz=player.location.z-Z;
      if (dx*dx+dz*dz<75*75)
        player.sendMessage('§a⚔ Underground PvP Arena ready! §7The arena is open for player battles.');
    }
    console.warn('[SparkMod] Underground PvP Arena placed at '+JSON.stringify(location)+'; rim Y='+String(baseY+49));
  } catch (e) {
    report(e);
    retryTick=system.currentTick+100;
  }
}
// An arena is a building only: player-vs-player damage follows the world's PvP setting.
// V232: the arena is now placed at a random plains spot by structures_v232.js.
// An arena already built at X 2000, Z 1500 in an older world is kept.
