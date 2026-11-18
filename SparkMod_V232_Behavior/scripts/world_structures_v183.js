import {terrainTop} from './terrain_v184.js';

// SparkMod V183: fixed unique world structures across a 5,000 x 5,000 map.
// Borders: X,Z -2500..2500. Placement is lazy, near players, once per world.
import {world,system} from '@minecraft/server';
const getDimension = () => world.getDimension('overworld');
const TOWERS=[
 [-2200,-2200],[0,-2200],[2200,-2200],
 [-2200,0],[2200,0],
 [-2200,2200],[0,2200],[2200,2200],
 [-1100,-2200]
];
// The fourth castle is now the starting castle at the original world spawn (see castle_spawn_v200.js).
const CASTLES=[[1200,-1200],[-1200,1200],[1200,1200]];
const SITES=[
 ...TOWERS.map(([x,z],i)=>({id:'tower_'+i,x,z,w:64,d:50,structure:'sparkmod:tower_graveyard',name:'Tower and Graveyard'})),
 ...CASTLES.map(([x,z],i)=>({id:'castle_'+(i+1),x,z,w:40,d:40,structure:'sparkmod:spark_castle',name:'Spark Castle'}))
];
const key=s=>'sparkmod:v183_structure_'+s.id;
const retries=new Map();
function tryPlace(site){
 const DIM=getDimension();
 if(world.getDynamicProperty(key(site))===true)return;
 if((retries.get(site.id)||0)>system.currentTick)return;
 if(!DIM.getPlayers().some(p=>(p.location.x-site.x)**2+(p.location.z-site.z)**2<100*100))return;
 const originX=site.x-Math.floor(site.w/2),originZ=site.z-Math.floor(site.d/2);
 try{
  const top=terrainTop(DIM,{x:site.x,z:site.z});
  if(!top)return;
  const y=top.location.y+1;
  // Do not place unless the entire footprint's corner chunks are loaded.
  for(const x of [originX,originX+site.w-1])
   for(const z of [originZ,originZ+site.d-1])
    if(!DIM.getBlock({x,y,z}))return;
  world.structureManager.place(site.structure,DIM,{x:originX,y,z:originZ});
  if(site.id.startsWith('castle_'))world.setDynamicProperty('sparkmod:v211_'+site.id+'_y',y);
  world.setDynamicProperty(key(site),true);
  for(const p of DIM.getPlayers()){
   if((p.location.x-site.x)**2+(p.location.z-site.z)**2<100*100)
    p.sendMessage('§6⚡ '+site.name+' generated at X '+site.x+', Z '+site.z+'.');
  }
 }catch(e){
  retries.set(site.id,system.currentTick+200);
  console.warn('[SparkMod V183] '+site.id+' placement postponed: '+e);
 }
}
// V232: fixed tower/castle positions retired - see structures_v232.js (random plains placement).
// Structures already built in older worlds are kept and counted.


// V192: Guaranteed additional graveyard, centered 300 horizontal blocks EAST
// of the world's default Overworld spawn (not the player's bed spawn).
// Placement is permanent per world and retries when the destination is loaded.
const SPAWN_GRAVEYARD_SITE='sparkmod:v192_spawn_graveyard_site';
const SPAWN_GRAVEYARD_PLACED='sparkmod:v192_spawn_graveyard_placed';
let nextGraveyardAttempt=0;

function ensureSpawnGraveyardSite(){
 let saved=world.getDynamicProperty(SPAWN_GRAVEYARD_SITE);
 if(typeof saved==='string'){
  try{
   const site=JSON.parse(saved);
   if(Number.isFinite(site.x)&&Number.isFinite(site.z))return site;
  }catch(e){console.warn('[SparkMod graveyard] Invalid saved site: '+e);}
 }
 // Safe to access World spawn: called in scheduled ticks, never during startup.
 const spawn=world.getDefaultSpawnLocation();
 if(!spawn||!Number.isFinite(spawn.x)||!Number.isFinite(spawn.z))return undefined;
 const site={x:Math.floor(spawn.x)+300,z:Math.floor(spawn.z)};
 world.setDynamicProperty(SPAWN_GRAVEYARD_SITE,JSON.stringify(site));
 return site;
}
function guaranteedSpawnGraveyard(){
 if(world.getDynamicProperty(SPAWN_GRAVEYARD_PLACED)===true)return;
 if(system.currentTick<nextGraveyardAttempt)return;
 const DIM=getDimension();
 const site=ensureSpawnGraveyardSite();
 if(!site)return;
 // Only attempt after the graveyard's chunks are being loaded by a player.
 const near=DIM.getPlayers().some(p=>(p.location.x-site.x)**2+(p.location.z-site.z)**2<110*110);
 if(!near)return;
 const footprintX=64,footprintZ=50;
 const origin={x:site.x-Math.floor(footprintX/2),z:site.z-Math.floor(footprintZ/2)};
 try{
  const terrain=terrainTop(DIM,{x:site.x,z:site.z});
  if(!terrain)return;
  const y=terrain.location.y+1;
  // Wait for the four corners so the build never silently fails at a chunk border.
  for(const x of [origin.x,origin.x+footprintX-1])
   for(const z of [origin.z,origin.z+footprintZ-1])
    if(!DIM.getBlock({x,y,z}))return;
  world.structureManager.place('sparkmod:tower_graveyard',DIM,{x:origin.x,y,z:origin.z});
  world.setDynamicProperty(SPAWN_GRAVEYARD_PLACED,true);
  for(const p of DIM.getPlayers()){
   if((p.location.x-site.x)**2+(p.location.z-site.z)**2<110*110)
    p.sendMessage(`§6⚡ Spawn Graveyard generated! Center X: ${site.x}, Y: ${y}, Z: ${site.z}.`);
  }
 }catch(e){
  nextGraveyardAttempt=system.currentTick+100;
  console.warn('[SparkMod graveyard] Will retry: '+e);
 }
}

// /scriptevent sparkmod:graveyard prints the pinned location and build status.
system.afterEvents.scriptEventReceive.subscribe(ev=>{
 if(ev.id!=='sparkmod:graveyard')return;
 const sender=ev.sourceEntity;
 if(sender?.typeId!=='minecraft:player')return;
 system.run(()=>{
  try{
   const site=ensureSpawnGraveyardSite();
   if(!site)return sender.sendMessage('§cGraveyard spawn location unavailable.');
   const status=world.getDynamicProperty(SPAWN_GRAVEYARD_PLACED)===true?'§aGENERATED':'§eWAITING FOR CHUNKS';
   sender.sendMessage(`§6§lSpawn Graveyard§r §fX: ${site.x}, Z: ${site.z} §7(${status}§7)`);
  }catch(e){sender.sendMessage('§cGraveyard location error: '+e);}
 });
});
// The region will populate when first visited; chunk generation is not possible
// before the destination area loads in a world with normal simulation distance.
// V232: the spawn graveyard is now one of the randomly placed towers (structures_v232.js).
