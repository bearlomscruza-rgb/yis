import {terrainTop} from './terrain_v184.js';
// SparkMod V166 - The Temple of Sparks uses the player's uploaded build.
// Original imported structure size: 50 (X) x 20 (Y) x 25 (Z).
// World centre remains X=1500, Z=1500, and the usable Spark Altar is kept.
// The previous 61x35x61 pyramid and approach are removed once in old worlds.
import { world, system } from '@minecraft/server';

const TX = 1500, TZ = 1500;
const NEW_FLAG = 'sparkmod:temple_custom_v166_placed';
const PREVIOUS_FLAG = 'sparkmod:temple_sparks_v114_placed';
const HEIGHT_KEY = 'sparkmod:temple_surface_y';
const STRUCTURE = 'sparkmod:temple_of_sparks';
const SIZE_X = 50, SIZE_Y = 20, SIZE_Z = 25;
const OFFSET_X = -25, OFFSET_Z = -12;
const SURFACE_OFFSET = 4; // The uploaded file's grass/dirt surface is at local Y=4.
const ALTAR_LOCAL = {x:33, y:5, z:12}; // Centered ABOVE the uploaded temple's beacon at (33,3,12), on its sandstone slab.

let pending = null;
let doneThisSession = false;
let retryAfter = 0;
let lastWarningTick = -99999;

function warn(reason) {
  if (system.currentTick - lastWarningTick < 1200) return;
  lastWarningTick = system.currentTick;
  console.warn('[SparkMod] Temple of Sparks replacement pending: ' + String(reason));
}
function surfaceAt(dimension, x, z) {
  const top = terrainTop(dimension,{x,z});
  if (!top) return undefined;
  let y = top.location.y;
  for (let j=0; j<25; j++,y--) {
    const block = dimension.getBlock({x,y,z});
    if (!block) return undefined;
    if (/leaves|log|wood|snow_layer|tallgrass|tall_grass|flower|grass$|vine|water|lava|mushroom|bamboo|cactus|seagrass|kelp|cobweb/.test(block.typeId)) continue;
    return y;
  }
  return top.location.y;
}
function withinTempleRange(dimension) {
  return dimension.getPlayers().some(player => {
    const dx=player.location.x-TX, dz=player.location.z-TZ;
    return dx*dx + dz*dz < 65*65;
  });
}
function previousTempleExists() {
  try { return world.getDynamicProperty(PREVIOUS_FLAG) === true; }
  catch { return false; }
}
function determineSurface(dimension, replacingOld) {
  const stored = world.getDynamicProperty(HEIGHT_KEY);
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  const measured = surfaceAt(dimension, TX, TZ);
  if (!Number.isFinite(measured)) return undefined;
  // The old pyramid's central tower rises about 31 blocks over its anchor.
  return replacingOld ? measured - 31 : measured;
}
function oldTempleClearance(surfaceY) {
  // Every command stays well under Bedrock's /fill block count limit.
  const actions = [];
  const addArea = (minX,maxX,minY,maxY,minZ,maxZ) => {
    for (let x=minX; x<=maxX; x+=16) for (let z=minZ; z<=maxZ; z+=16) {
      actions.push({x1:x,z1:z,x2:Math.min(x+15,maxX),z2:Math.min(z+15,maxZ),y1:minY,y2:maxY});
    }
  };
  addArea(TX-30,TX+30,surfaceY-3,surfaceY+31,TZ-30,TZ+30);
  // Remove the previous approach road and signposts, not part of the new temple.
  addArea(TX-18,TX+18,surfaceY,surfaceY+14,TZ-62,TZ-31);
  return actions;
}
function startPlacement(dimension) {
  if (pending || doneThisSession || system.currentTick < retryAfter) return;
  try {
    if (world.getDynamicProperty(NEW_FLAG) === true) {
      doneThisSession = true;
      return;
    }
    if (!withinTempleRange(dimension)) return;
    const replacingOld = previousTempleExists();
    const surfaceY = determineSurface(dimension, replacingOld);
    if (!Number.isFinite(surfaceY)) return;
    const originY = Math.max(-60, Math.min(300, surfaceY-SURFACE_OFFSET));
    const clear = replacingOld ? oldTempleClearance(surfaceY) : [];
    const corners=[[0,0],[SIZE_X-1,0],[0,SIZE_Z-1],[SIZE_X-1,SIZE_Z-1]];
    if(!corners.every(([dx,dz])=>dimension.getBlock({x:TX+OFFSET_X+dx,y:originY,z:TZ+OFFSET_Z+dz})))return;
    pending = {dimension, surfaceY:originY+SURFACE_OFFSET, originY, clear, index:0};
    if (replacingOld) {
      for (const p of dimension.getPlayers()) {
        const dx=p.location.x-TX, dz=p.location.z-TZ;
        if (dx*dx+dz*dz<85*85) p.sendMessage('§e[SparkMod] Replacing the old Temple of Sparks with the new uploaded structure. Stand clear of the temple.');
      }
    }
  } catch(err) {warn(err);retryAfter=system.currentTick+100;}
}
function runPlacementTick() {
  if (!pending) return;
  const p = pending;
  try {
    // One small fill per game tick reduces command load on mobile and Realms.
    if (p.index < p.clear.length) {
      const q=p.clear[p.index];
      p.dimension.runCommand(`fill ${q.x1} ${q.y1} ${q.z1} ${q.x2} ${q.y2} ${q.z2} air`);
      p.index++;
      return;
    }
    const pos = {x:TX+OFFSET_X, y:p.originY, z:TZ+OFFSET_Z};
    world.structureManager.place(STRUCTURE,p.dimension,pos);
    // Verify structure footprint actually loaded before marking complete.
    if(!p.dimension.getBlock({x:pos.x+33,y:pos.y+3,z:pos.z+12}))
      throw Error('Temple placement verification failed');
    // The original beacon is at local (33,3,12), with its slab at Y=4.
    // Put the Spark Altar at (33,5,12) directly above it; preserve the beacon
    // and all other blocks from the uploaded temple.
    const altar = p.dimension.getBlock({x:pos.x+ALTAR_LOCAL.x,y:pos.y+ALTAR_LOCAL.y,z:pos.z+ALTAR_LOCAL.z});
    if (!altar) throw Error('Temple altar location is in an unloaded chunk');
    altar.setType('sparkmod:spark_altar');
    // Don't leave the source export's structure block in the ground corner.
    const sourceMarker = p.dimension.getBlock({x:pos.x,y:pos.y+5,z:pos.z});
    if (sourceMarker?.typeId === 'minecraft:structure_block') sourceMarker.setType('minecraft:air');
    world.setDynamicProperty(HEIGHT_KEY,p.surfaceY);
    world.setDynamicProperty(PREVIOUS_FLAG,true);
    world.setDynamicProperty(NEW_FLAG,true);
    doneThisSession = true;
    pending = null;
    console.warn('[SparkMod] Uploaded Temple of Sparks placed with altar above beacon at X=1508 Z=1500.');
  } catch(err) {
    warn(err);
    pending=null;
    retryAfter=system.currentTick+100;
  }
}

system.runInterval(() => {
  if (pending || doneThisSession || system.currentTick<retryAfter) return;
  try { startPlacement(world.getDimension('overworld')); }
  catch(err) { warn(err); retryAfter=system.currentTick+100; }
},100);
system.runInterval(runPlacementTick,1);
