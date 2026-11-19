import {terrainTop} from './terrain_v184.js';
import {world,system} from '@minecraft/server';
import {getSite,siteOf} from './sites_v244.js';

// V187: Existing V186 worlds keep their colosseum and completion flag.
// The imported structure is 64 x 20 x 50, with its central floor at local Y=3.
// V244: the position comes from sites_v244.js (classic X 1750 Z 1500 unless that's ocean/river).
let CX=1750,CZ=1500;const SX=64,SZ=50;
const FLAG='sparkmod:colosseum_sparks_v182_placed';
const YKEY='sparkmod:colosseum_sparks_v182_y';
const BOSS='sparkmod:bolt_titan';
const FORMS=[BOSS,'sparkmod:spark_demon','sparkmod:bolt_titan_phase3'];
const DEAD='sparkmod:bolt_titan_defeated';
const PAYMENT='minecraft:diamond';
const SUMMONED='sparkmod:colosseum_diamond_summoned_v204';
let ORIGIN={x:CX-32,z:CZ-25};
function refreshSite(){const s=siteOf('colosseum');CX=s.x;CZ=s.z;ORIGIN={x:CX-32,z:CZ-25};return !!getSite('colosseum');}
const safe=(fn,fallback)=>{try{return fn();}catch(e){console.warn('[Spark Colosseum] '+e);return fallback;}};
const getDimension=()=>world.getDimension('overworld');
let placementAttempt=0,spawning=false,lastWarn=0;
function yValue(){return safe(()=>world.getDynamicProperty(YKEY));}
function chestPosition(y){return {x:CX,y:y+4,z:CZ};}
function near(dim,range=110){return dim.getPlayers().filter(p=>(p.location.x-CX)**2+(p.location.z-CZ)**2<range*range);}
function notify(dim,text){for(const p of near(dim,100))safe(()=>p.sendMessage(text));}
function getChest(dim,y){return safe(()=>dim.getBlock(chestPosition(y)),null);}

// Structure-block export marker is located at local (0,3,0), the arena's edge.
// Also removes the marker from older worlds that already have a placed colosseum.
function removeSourceMarker(dim,y){
 const marker=safe(()=>dim.getBlock({x:ORIGIN.x,y:y+3,z:ORIGIN.z}),null);
 if(marker?.typeId==='minecraft:structure_block')safe(()=>marker.setType('minecraft:grass_block'));
}

// Put the summoning chest visibly ON the central floor, not buried at Y+2.
// Preserve items accidentally placed into an older underground chest.
function ensureChest(dim,y){
 if(typeof y!=='number')return false;
 const floor=safe(()=>dim.getBlock({x:CX,y:y+3,z:CZ}),null);
 const top=getChest(dim,y);
 if(!floor||!top)return false;
 if(top.typeId!=='minecraft:chest')safe(()=>top.setType('minecraft:chest'));
 if(floor.typeId!=='minecraft:gold_block')safe(()=>floor.setType('minecraft:gold_block'));
 const actual=getChest(dim,y);
 if(actual?.typeId!=='minecraft:chest')return false;
 const old=safe(()=>dim.getBlock({x:CX,y:y+2,z:CZ}),null);
 if(old?.typeId==='minecraft:chest'){
  const oldInv=safe(()=>old.getComponent('minecraft:inventory')?.container,null);
  const newInv=safe(()=>actual.getComponent('minecraft:inventory')?.container,null);
  // Never remove the old chest if its contents cannot be moved safely.
  if(oldInv && newInv){
   for(let i=0;i<oldInv.size;i++){
    const item=safe(()=>oldInv.getItem(i),null);
    if(!item)continue;
    const leftover=safe(()=>newInv.addItem(item),item);
    if(leftover){safe(()=>dim.spawnItem(leftover,{x:CX+.5,y:y+5,z:CZ+.5}));}
    oldInv.setItem(i,undefined);
   }
   safe(()=>old.setType('minecraft:dirt'));
  }
 }
 removeSourceMarker(dim,y);
 return true;
}
// A new pack UUID can hide dynamic properties created by an older SparkMod pack.
// Detect the V186 arena physically so a new version won't overwrite the player's world.
function existingOriginY(dim){
 const top=safe(()=>terrainTop(dim,{x:ORIGIN.x,z:ORIGIN.z}),null);
 if(!top)return null;
 for(let height=top.location.y; height>=Math.max(-64,top.location.y-32);height--){
  const b=safe(()=>dim.getBlock({x:ORIGIN.x,y:height,z:ORIGIN.z}),null);
  if(b?.typeId==='minecraft:structure_block')return height-3;
 }
 const center=safe(()=>terrainTop(dim,{x:CX,z:CZ}),null);
 if(!center)return null;
 for(let height=center.location.y+4; height>=Math.max(-64,center.location.y-24);height--){
  const b=safe(()=>dim.getBlock({x:CX,y:height,z:CZ}),null);
  if(b?.typeId!=='minecraft:chest')continue;
  // V186 put the chest at y+2 (two blocks below the usable chest).
  const y=height-2;
  const floor=safe(()=>dim.getBlock({x:CX,y:y+3,z:CZ}),null);
  if(floor&&!floor.isAir)return y;
 }
 return null;
}
function build(){
 const dim=getDimension();
 if(!near(dim).length)return;
 if(world.getDynamicProperty(FLAG)!==true){
  const previous=existingOriginY(dim);
  if(typeof previous==='number'){
   world.setDynamicProperty(YKEY,previous);
   world.setDynamicProperty(FLAG,true);
   ensureChest(dim,previous);
   notify(dim,'§6⚡ Existing Colosseum found! Put 1 diamond in the golden central chest to awaken the Titan.');
   return;
  }
 }
 if(world.getDynamicProperty(FLAG)===true){
  // An already-live boss should not have a second summon chest in its arena.
  if(aliveForms().length){
   world.setDynamicProperty(SUMMONED,true);
   const y=yValue();if(typeof y==='number'){
    const chest=getChest(dim,y);
    if(chest?.typeId==='minecraft:chest')safe(()=>chest.setType('minecraft:gold_block'));
   }
   return;
  }
  ensureChest(dim,yValue());
  return;
 }
 if(system.currentTick<placementAttempt)return;
 // V243: sit at the middle height of the ground across the whole arena (not just the centre),
 // then structures_v232.js blends the surrounding land into a natural slope.
 const heights=[[CX,CZ],[ORIGIN.x+4,ORIGIN.z+4],[ORIGIN.x+SX-5,ORIGIN.z+4],[ORIGIN.x+4,ORIGIN.z+SZ-5],[ORIGIN.x+SX-5,ORIGIN.z+SZ-5],
  [CX,ORIGIN.z+4],[CX,ORIGIN.z+SZ-5],[ORIGIN.x+4,CZ],[ORIGIN.x+SX-5,CZ]].map(([x,z])=>safe(()=>terrainTop(dim,{x,z})?.location.y,null));
 if(heights.some(h=>typeof h!=='number'))return;
 heights.sort((a,b)=>a-b);
 const y=heights[Math.floor(heights.length/2)]+1;
 const corners=[{x:ORIGIN.x,y,z:ORIGIN.z},{x:ORIGIN.x+SX-1,y,z:ORIGIN.z+SZ-1}];
 if(corners.some(p=>!safe(()=>dim.getBlock(p),null)))return;
 try{
  world.structureManager.place('sparkmod:colosseum_of_sparks',dim,{x:ORIGIN.x,y,z:ORIGIN.z});
  if(!ensureChest(dim,y))throw Error('Central summoning chest not available');
  world.setDynamicProperty(YKEY,y);
  world.setDynamicProperty(FLAG,true);
  notify(dim,'§6⚡ Colosseum ready! Put 1 diamond in the central chest to summon the Bolt Titan.');
 }catch(e){console.warn('[Spark Colosseum] Placement delayed: '+e);placementAttempt=system.currentTick+200;}
}
function aliveForms(){
 const found=[];
 for(const id of ['overworld','nether','the_end']){
  const dim=safe(()=>world.getDimension(id),null);
  if(!dim)continue;
  for(const type of FORMS)found.push(...safe(()=>dim.getEntities({type}),[]));
 }
 return found.filter(e=>safe(()=>typeof e.isValid==='function'?e.isValid():e.isValid!==false,false));
}
function enforceSingleBoss(){
 const forms=aliveForms();
 if(forms.length<=1)return;
 forms.sort((a,b)=>Number(b.hasTag('sparkmod:colosseum_titan'))-Number(a.hasTag('sparkmod:colosseum_titan'))||a.id.localeCompare(b.id));
 for(const duplicate of forms.slice(1))safe(()=>duplicate.remove());
}
function offer(){
 const dim=getDimension();
 if(world.getDynamicProperty(FLAG)!==true||world.getDynamicProperty(DEAD)===true)return;
 const nearby=near(dim,70);
 if(!nearby.length)return;
 const y=yValue();if(typeof y!=='number')return;
 const chest=getChest(dim,y);
 if(chest?.typeId!=='minecraft:chest')return;
 const inv=safe(()=>chest.getComponent('minecraft:inventory')?.container,null);
 if(!inv)return;
 let count=0;
 for(let i=0;i<inv.size;i++){
  const item=safe(()=>inv.getItem(i),null);
  if(item?.typeId===PAYMENT)count+=item.amount;
 }
 if(count<1)return;
 if(spawning||aliveForms().length){
  for(const p of nearby)safe(()=>p.onScreenDisplay.setActionBar('§cA Bolt Titan already exists. Your diamond remains in the chest.'));
  return;
 }
 // Exact horizontal center of the uploaded 64 x 20 x 50 structure.
 // The central chest is at Y+4; boss feet appear just above its top face.
 const spawn={x:CX+.5,y:y+5.05,z:CZ+.5};
 spawning=true;
 try{
  const titan=dim.spawnEntity(BOSS,spawn);
  if(!titan)throw Error('Bolt Titan spawn returned no entity');
  titan.addTag('sparkmod:colosseum_titan');
  titan.nameTag='§6§lBOLT TITAN';
  // Charge ONE diamond only after a successful boss spawn. Keep any other
  // items deposited in this chest by dropping them safely beside the plinth.
  let paid=false;
  const leftovers=[];
  for(let i=0;i<inv.size;i++){
   const item=inv.getItem(i);if(!item)continue;
   if(!paid && item.typeId===PAYMENT){
    paid=true;
    if(item.amount>1){item.amount-=1;leftovers.push(item);} // spare diamonds returned
   }else leftovers.push(item);
  }
  if(!paid)throw Error('A diamond was removed before summoning completed');
  // Persist the consumed summon BEFORE removing the chest so the 2-second
  // builder will not recreate it, including after the boss transforms.
  world.setDynamicProperty(SUMMONED,true);
  chest.setType('minecraft:gold_block');
  for(const item of leftovers)safe(()=>dim.spawnItem(item,{x:CX+.5,y:y+5.4,z:CZ+1.5}));
  for(const p of nearby){
   safe(()=>p.sendMessage('§6⚡ 1 diamond consumed! The chest vanished and the Bolt Titan awakened!'));
   safe(()=>p.playSound('mob.warden.roar',{volume:1,pitch:0.8}));
  }
 }catch(e){console.warn('[Spark Colosseum] Summon failed: '+e);}
 finally{spawning=false;}
}
// World access is deferred until tick callbacks (fix from V186).
system.runInterval(()=>{if(refreshSite())safe(build);},40);
system.runInterval(()=>{if(refreshSite())safe(offer);},20);
system.runInterval(()=>safe(enforceSingleBoss),40);
