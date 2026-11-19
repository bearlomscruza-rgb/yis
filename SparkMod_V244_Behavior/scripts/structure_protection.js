// V169: Prevent player editing inside the two player-provided structures.
// Temple center 1500,1500 (50x20x25); PvP arena center 2000,1500 (35x50x35).
import {world,system} from '@minecraft/server';
import {sites as randomSites} from './structures_v232.js';
import {siteOf} from './sites_v244.js';

// V211: all four player-built Spark Castles are permanently protected.
// The spawn castle follows the original world spawn, not fixed coordinates.
const CASTLE_COORDS=[[1200,-1200,1],[-1200,1200,2],[1200,1200,3]];
export function inSparkCastle(pos){
  if(world.getDynamicProperty('sparkmod:v200_castle_spawn_placed')===true){
    let site;
    try {site=JSON.parse(world.getDynamicProperty('sparkmod:v200_castle_spawn_site')||'null');} catch {}
    const y=world.getDynamicProperty('sparkmod:v200_castle_spawn_y');
    if(site && Number.isFinite(site.x) && Number.isFinite(site.z) &&
       pos.x>=site.x-20 && pos.x<site.x+20 && pos.z>=site.z-20 && pos.z<site.z+20 &&
       (typeof y!=='number' || (pos.y>=y && pos.y<y+30)))return true;
  }
  // V232: randomly placed castles.
  for(const s of randomSites())if(s.type==='castle'&&pos.x>=s.x-20&&pos.x<s.x+20&&pos.z>=s.z-20&&pos.z<s.z+20&&pos.y>=s.y&&pos.y<s.y+30)return true;
  for(const [x,z,index] of CASTLE_COORDS){
    if(world.getDynamicProperty('sparkmod:v183_structure_castle_'+index)!==true)continue;
    const y=world.getDynamicProperty('sparkmod:v211_castle_'+index+'_y');
    if(pos.x>=x-20 && pos.x<x+20 && pos.z>=z-20 && pos.z<z+20 &&
      (typeof y!=='number' || (pos.y>=y && pos.y<y+30)))return true;
  }
  return false;
}

export function inside(pos){
  if(inSparkCastle(pos))return true;
  const ty=world.getDynamicProperty('sparkmod:temple_surface_y');
  const ay=world.getDynamicProperty('sparkmod:underground_pvp_arena_v167_surface_y');
  // Restrict only after each structure has successfully generated.
  if(world.getDynamicProperty('sparkmod:temple_custom_v166_placed')===true &&
     typeof ty==='number' && (()=>{const t=siteOf('shrine');return pos.x>=t.x-25 && pos.x<t.x+25 &&
     pos.z>=t.z-12 && pos.z<t.z+13;})() && pos.y>=ty-5 && pos.y<=ty+18)return true;
  // V232: the arena may be at a random spot; older worlds keep it at X 2000, Z 1500.
  let arena={x:2000,z:1500};
  try{const s=JSON.parse(world.getDynamicProperty('sparkmod:v232_arena_site')||'null');if(s)arena=s;}catch{}
  if(world.getDynamicProperty('sparkmod:underground_pvp_arena_v167_placed')===true &&
     typeof ay==='number' && pos.x>=arena.x-17 && pos.x<arena.x+18 &&
     pos.z>=arena.z-17 && pos.z<arena.z+18 && pos.y>=ay-50 && pos.y<=ay+2)return true;
  const cy=world.getDynamicProperty('sparkmod:colosseum_sparks_v182_y');
  if(world.getDynamicProperty('sparkmod:bolt_titan_defeated')!==true &&
     world.getDynamicProperty('sparkmod:colosseum_sparks_v182_placed')===true &&
     typeof cy==='number' && (()=>{const c=siteOf('colosseum');return pos.x>=c.x-32 && pos.x<c.x+32 &&
     pos.z>=c.z-25 && pos.z<c.z+25;})() && pos.y>=cy && pos.y<cy+20)return true;
  return false;
}
function protect(event){
  try{
    const p=event.player;
    if(!p || p.dimension.id!=='minecraft:overworld')return;
    if(inside(event.block.location)){
      event.cancel=true;
      system.run(()=>{try{p.onScreenDisplay.setActionBar('§e⚡ This SparkMod structure is protected.');}catch{}});
    }
  }catch(e){console.warn('[SparkMod protection] '+String(e));}
}
world.beforeEvents.playerBreakBlock.subscribe(protect);
// Stable 2.0 does not expose the experimental placement event.
world.beforeEvents.playerPlaceBlock?.subscribe(protect);
const faces={Up:[0,1,0],Down:[0,-1,0],North:[0,0,-1],South:[0,0,1],East:[1,0,0],West:[-1,0,0]};
world.beforeEvents.playerInteractWithBlock.subscribe(event=>{
  if(event.player.dimension.id!=='minecraft:overworld')return;
  const pos=event.block.location;
  // Allow doors, chests, and normal interactions inside the protected castles.
  // Breaking and placing remain blocked by their separate before-events.
  if(inSparkCastle(pos))return;
  // Keep the altar functional; its own listener opens the menu.
  if(event.block.typeId==='sparkmod:spark_altar' && !event.player.isSneaking)return;
  // Players must be able to open the central summoning chest and deposit a diamond.
  const chestY=world.getDynamicProperty('sparkmod:colosseum_sparks_v182_y');
  if(event.block.typeId==='minecraft:chest' && typeof chestY==='number' &&
     pos.x===siteOf('colosseum').x && pos.z===siteOf('colosseum').z && pos.y===chestY+4)return;
  const d=faces[event.blockFace]||[0,0,0];
  if(inside(pos)||inside({x:pos.x+d[0],y:pos.y+d[1],z:pos.z+d[2]})){
    event.cancel=true;
  }
});
world.beforeEvents.explosion.subscribe(event=>{
  if(event.dimension.id!=='minecraft:overworld')return;
  event.setImpactedBlocks(event.getImpactedBlocks().filter(block=>!inside(block.location)));
});
