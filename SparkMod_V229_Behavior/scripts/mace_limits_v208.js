
import {world,system,EquipmentSlot,ItemLockMode} from '@minecraft/server';
import {getConfig} from './spark_config.js';

// V214: THREE currently tracked ordinary maces, ONE Spark Mace permanently.
// Items tracked with persistent item-stack IDs. Excess newly acquired items
// are cleared after creation; Bedrock does not expose a cancellable vanilla craft event.
// Stock previously present is grandfathered only if within limits.
const KEY='sparkmod:v208_mace_ids';
const LIVE_KEY='sparkmod:v214_live_maces';
const CREATIVE_KEY='sparkmod:v215_creative_spark_maces';
// Don't free slots immediately when a mace moves through unloaded chunks.
const MISSING_GRACE_MS=120000;
const MACE='minecraft:mace',OLD='sparkmod:spark_mace';
const MARKER='§8SparkMod: genuine vanilla mace';
// A Spark Mace is a vanilla Minecraft mace with this lore marker.
// It NEVER contributes to the regular mace allowance.
const idKey='sparkmod:v208_mace_identifier';
const SPARK_ARMOR=new Set([
 'sparkmod:god_helmet','sparkmod:god_helmet_v3',
 'sparkmod:god_chestplate','sparkmod:god_chestplate_v3',
 'sparkmod:god_leggings','sparkmod:god_leggings_v3',
 'sparkmod:god_boots','sparkmod:god_boots_v3',
 'sparkmod:spark_sword','sparkmod:awakened_spark_sword'
]);
const validType=item=>item && (item.typeId===MACE || item.typeId===OLD);
const special=item=>validType(item) && (item.typeId===OLD ||
   (item.getLore?.()??[]).includes(MARKER) ||
   item.nameTag==='§6Spark Mace' ||
   item.nameTag==='§5⚡ Awakened Spark Mace');
const safe=(fn,alt)=>{try{return fn();}catch(e){console.warn('[Spark Mace Limits] '+e);return alt;}};
// Keep the legacy permanent Spark Mace history intact, but normal maces use
// last-seen timestamps. Previous V213 normal IDs are migrated on first V214 run;
// items not found will release a slot after the grace period.
const known=()=>safe(()=>JSON.parse(world.getDynamicProperty(KEY)||'{"normal":[],"spark":[]}'),{normal:[],spark:[]});
const save=data=>safe(()=>world.setDynamicProperty(KEY,JSON.stringify(data)));
const live=()=>safe(()=>JSON.parse(world.getDynamicProperty(LIVE_KEY)||'null'),null);
const saveLive=data=>safe(()=>world.setDynamicProperty(LIVE_KEY,JSON.stringify(data)));
function beginCycle(){
 const legacy=known();
 const now=Date.now();
 const data=live()||{normal:Object.fromEntries((legacy.normal||[]).map(id=>[id,now])),spark:legacy.spark||[]};
 data.normal=data.normal||{};
 data.spark=Array.isArray(data.spark)?data.spark:[];
 for(const [id,t] of Object.entries(data.normal)){
  if(!Number.isFinite(t)||now-t>MISSING_GRACE_MS)delete data.normal[id];
 }
 return {data,now,seen:new Set(),creative:new Set(safe(()=>JSON.parse(world.getDynamicProperty(CREATIVE_KEY)||'[]'),[]))};
}
let serial=0;
// V212: Spark equipment and both mace types are tradable by dropping, and drop on death.
// They are never inventory-locked. Keep the existing global mace identity limits.
const forbiddenStorage=item=>item && (validType(item) || SPARK_ARMOR.has(item.typeId));
function protect(stack){
 if(!forbiddenStorage(stack))return false;
 let changed=false;
 if(stack.keepOnDeath===true){stack.keepOnDeath=false;changed=true;}
 if(stack.lockMode!==ItemLockMode.none){stack.lockMode=ItemLockMode.none;changed=true;}
 // Ordinary and Spark Maces retain the no-durability-loss property.
 if(validType(stack)){
  const durability=safe(()=>stack.getComponent('minecraft:durability'));
  if(durability && durability.damage>0){durability.damage=0;changed=true;}
 }
 return changed;
}

function inspect(stack,cycle,creative=false){
 if(!stack)return {stack,changed:false};
 if(!validType(stack))return {stack,changed:protect(stack)};
 const category=special(stack)?'spark':'normal';
 let id=safe(()=>stack.getDynamicProperty(idKey));
 let changed=false;
 if(!id){id=category+'_'+Date.now().toString(36)+'_'+(++serial);safe(()=>stack.setDynamicProperty(idKey,id));changed=true;}
 if(category==='normal'){
  // A previously missing mace keeps its original identity when found again.
  // If it wasn't recorded during this cycle, it consumes one of three slots.
  if(!(id in cycle.data.normal)){
   if(Object.keys(cycle.data.normal).length>=getConfig().maceLimit)return {stack:null,changed:true,excess:true,category};   // V229: /deck3 limit
  }
  cycle.data.normal[id]=cycle.now;
  cycle.seen.add(id);
 }else if(creative){
  if(!cycle.creative.has(id) && cycle.creative.size>=5)return {stack:null,changed:true,excess:true,category:'creative'};
  cycle.creative.add(id);
 }else if(creative){
  if(!cycle.creative.has(id) && cycle.creative.size>=5)return {stack:null,changed:true,excess:true,category:'creative'};
  cycle.creative.add(id);
 }else{
  if(!cycle.data.spark.includes(id)){
   if(cycle.data.spark.length>=getConfig().sparkMaceLimit)return {stack:null,changed:true,excess:true,category};   // V229: /deck3 limit
   cycle.data.spark.push(id);
  }
 }
 return {stack,changed:protect(stack)||changed};
}
function visit(container,cycle,owner,storageContext,creative=false){
 if(!container)return;
 const size=safe(()=>container.size,0);
 for(let i=0;i<size;i++){
  const stack=safe(()=>container.getItem(i));if(!stack)continue;
  // First fix any item locks and register/validate mace identities.
  const result=inspect(stack,cycle,creative);
  if(result.excess){
   safe(()=>container.setItem(i,undefined));
   if(owner)safe(()=>owner.sendMessage(result.category==='creative'?'§cMaximum FIVE Creative Spark Maces in this world. Extra copy removed.':result.category==='spark'?`§cOnly ${getConfig().sparkMaceLimit} survival Spark Mace(s) may exist in this world. Extra copy removed.`:`§cOnly ${getConfig().maceLimit} normal mace(s) may exist in this world. Extra mace removed.`));
   continue;
  }
  // Maces, Spark swords, and Spark armor cannot be stored. Eject to world
  // directly outside the storage rather than deleting earned rare gear.
  if(storageContext && forbiddenStorage(result.stack)){
   const {dimension,location}=storageContext;
   const stackToEject=result.stack;
   const position={x:location.x+0.5,y:location.y+0.8,z:location.z+0.5};
   const spawned=safe(()=>dimension.spawnItem(stackToEject,position),null);
   if(spawned){safe(()=>container.setItem(i,undefined));}
   continue;
  }
  if(result.changed)safe(()=>container.setItem(i,result.stack));
 }
}

function scanPlayer(p,cycle){
 const creative=safe(()=>p.getGameMode()==='Creative',false);
 visit(safe(()=>p.getComponent('minecraft:inventory')?.container),cycle,p,null,creative);
 const eq=safe(()=>p.getComponent('minecraft:equippable'));
 if(!eq)return;
 for(const slot of [EquipmentSlot.Mainhand,EquipmentSlot.Offhand,EquipmentSlot.Head,EquipmentSlot.Chest,EquipmentSlot.Legs,EquipmentSlot.Feet]){
  const stack=safe(()=>eq.getEquipment(slot));if(!stack)continue;
  const result=inspect(stack,cycle,creative);
  if(result.changed)safe(()=>eq.setEquipment(slot,result.stack||undefined));
 }
}
function scanLoose(dim,cycle){
 const players=dim.getPlayers();
 if(!players.length)return;
 for(const p of players){
  // Scan nearby dropped items and storage, including minecarts and mobs with inventories.
  for(const e of safe(()=>dim.getEntities({location:p.location,maxDistance:24}),[])){
   if(e.typeId==='minecraft:player')continue;
   if(e.typeId==='minecraft:item'){
    const stack=safe(()=>e.getComponent('minecraft:item')?.itemStack);
    if(forbiddenStorage(stack)){
      const result=inspect(stack,cycle,creative);
      // Re-spawn a legacy locked dropped stack with no lock; do not count it as a new craft.
      if(result.excess)safe(()=>e.remove());
      else if(result.changed)safe(()=>{
        const drop=e.location;
        e.remove();
        dim.spawnItem(result.stack,drop);
      });
    }
   }else visit(safe(()=>e.getComponent('minecraft:inventory')?.container),cycle,null,{dimension:dim,location:e.location});
  }
  const cx=Math.floor(p.location.x),cy=Math.floor(p.location.y),cz=Math.floor(p.location.z);
  // Loaded, nearby storage only. Unloaded container contents cannot be scanned.
  for(let x=cx-5;x<=cx+5;x++)for(let y=cy-2;y<=cy+2;y++)for(let z=cz-5;z<=cz+5;z++){
    const block=safe(()=>dim.getBlock({x,y,z}));
    if(!block)continue;
    visit(safe(()=>block.getComponent('minecraft:inventory')?.container),cycle,null,{dimension:dim,location:block.location});
  }
 }
}
system.runInterval(()=>{
 const cycle=beginCycle();
 for(const p of world.getAllPlayers())scanPlayer(p,cycle);
 for(const name of ['overworld','nether','the_end']){
   const dim=safe(()=>world.getDimension(name));
   if(dim)scanLoose(dim,cycle);
 }
 saveLive(cycle.data);
 safe(()=>world.setDynamicProperty(CREATIVE_KEY,JSON.stringify([...cycle.creative])));
 // Preserve Spark Mace history so only one Spark Mace can ever be rolled.
 const legacy=known();
 legacy.spark=cycle.data.spark;
 save(legacy);
},60);
