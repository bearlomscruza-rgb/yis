import {world, system, EquipmentSlot} from '@minecraft/server';
import {getConfig} from './spark_config.js';

// SparkMod V205: no vanilla bundles in any script-accessible location.
// Covers players, equipped/selected/offhand/cursor items, dropped bundles,
// mob/cart inventories, loaded container blocks, and nested storage items.
// Offline players and unloaded chunks cannot be inspected by the Script API.

const COLOR_NAMES = [
 'white','orange','magenta','light_blue','yellow','lime','pink','gray',
 'light_gray','cyan','purple','blue','brown','green','red','black'
];
const BUNDLES = new Set(['minecraft:bundle', ...COLOR_NAMES.map(c=>'minecraft:'+c+'_bundle')]);
const DIMENSIONS=['overworld','nether','the_end'];
const SLOT_NAMES=[EquipmentSlot.Mainhand,EquipmentSlot.Offhand,EquipmentSlot.Head,
                  EquipmentSlot.Chest,EquipmentSlot.Legs,EquipmentSlot.Feet];
const HORIZONTAL=7, VERTICAL=4, BATCH=180;
const SIDE=HORIZONTAL*2+1, VHEIGHT=VERTICAL*2+1, BLOCKS=SIDE*SIDE*VHEIGHT;
const knownBlocks=new Map();
const scanState=new Map();
const pendingPlayers=new Set();
const safe=(fn,fallback)=>{try{return fn();}catch(e){
 console.warn('[SparkMod V205 bundles] '+String(e));return fallback;
}};
// V229: can be switched off with /deck3.
const isBundle=item=>!!item && BUNDLES.has(item.typeId) && getConfig().clearBundles;

// Keep non-bundle items. Item storage components are traversed recursively when exposed.
function purgeInventory(container,depth=0){
 if(!container||depth>5)return 0;
 const count=safe(()=>container.size,0);
 let cleared=0;
 for(let i=0;i<count;i++){
  const stack=safe(()=>container.getItem(i),null);
  if(!stack)continue;
  if(isBundle(stack)){
   const removed=safe(()=>{container.setItem(i,undefined);return stack.amount;},0);
   cleared+=removed;
   continue;
  }
  if(depth<5){
   const child=safe(()=>stack.getComponent('minecraft:inventory')?.container,null);
   if(child){
    const childCount=purgeInventory(child,depth+1);
    cleared+=childCount;
    // Some storage items copy their inventory when read; write back when possible.
    if(childCount)safe(()=>container.setItem(i,stack));
   }
  }
 }
 return cleared;
}
function purgePlayer(player){
 if(!player)return 0;
 let removed=0;
 removed+=purgeInventory(safe(()=>player.getComponent('minecraft:inventory')?.container));
 const equipment=safe(()=>player.getComponent('minecraft:equippable'));
 if(equipment)for(const slot of SLOT_NAMES){
  const item=safe(()=>equipment.getEquipment(slot));
  if(isBundle(item))removed+=safe(()=>{equipment.setEquipment(slot,undefined);return item.amount;},0);
 }
 const cursor=safe(()=>player.getComponent('minecraft:cursor_inventory'));
 if(cursor && isBundle(safe(()=>cursor.item)))removed+=safe(()=>{cursor.clear();return 1;},0);
 return removed;
}
function purgeEntity(entity){
 if(!entity)return 0;
 const type=safe(()=>entity.typeId,'');
 if(type==='minecraft:player')return purgePlayer(entity);
 if(type==='minecraft:item'){
  const dropped=safe(()=>entity.getComponent('minecraft:item')?.itemStack,null);
  if(isBundle(dropped))return safe(()=>{entity.remove();return dropped.amount;},0);
  return 0;
 }
 let n=purgeInventory(safe(()=>entity.getComponent('minecraft:inventory')?.container));
 const equip=safe(()=>entity.getComponent('minecraft:equippable'));
 if(equip)for(const slot of SLOT_NAMES){
  const item=safe(()=>equip.getEquipment(slot));
  if(isBundle(item))n+=safe(()=>{equip.setEquipment(slot,undefined);return item.amount;},0);
 }
 return n;
}
function key(d,pos){return d.id+':'+Math.floor(pos.x)+','+Math.floor(pos.y)+','+Math.floor(pos.z);}
function remember(d,pos){
 if(!d||!pos)return;
 const id=key(d,pos);
 knownBlocks.set(id,{dimension:d.id,pos:{x:Math.floor(pos.x),y:Math.floor(pos.y),z:Math.floor(pos.z)},at:system.currentTick});
 if(knownBlocks.size>1024){
  const oldest=knownBlocks.keys().next().value;
  if(oldest!==undefined)knownBlocks.delete(oldest);
 }
}
function purgeBlock(d,pos){
 const b=safe(()=>d.getBlock(pos));
 if(!b)return 0;
 return purgeInventory(safe(()=>b.getComponent('minecraft:inventory')?.container));
}
function deferredPlayer(player){
 if(!player || pendingPlayers.has(player.id))return;
 const id=player.id;pendingPlayers.add(id);
 system.run(()=>{pendingPlayers.delete(id);safe(()=>purgePlayer(player));});
}
function deferredEntity(entity){system.run(()=>safe(()=>purgeEntity(entity)));}
function deferredBlock(block){
 if(!block)return;
 const d=safe(()=>block.dimension),p=safe(()=>block.location);
 if(!d||!p)return;
 remember(d,p);
 system.run(()=>safe(()=>purgeBlock(d,p)));
}
// Don't let bundles be used to put contents into frames, blocks or entities.
world.beforeEvents.itemUse?.subscribe(ev=>{if(isBundle(ev.itemStack))ev.cancel=true;});
world.beforeEvents.playerInteractWithBlock?.subscribe(ev=>{
 if(isBundle(ev.itemStack))ev.cancel=true;
});
world.beforeEvents.playerInteractWithEntity?.subscribe(ev=>{
 if(isBundle(ev.itemStack))ev.cancel=true;
});

// Rapid responses to acquiring an item, using storage, and loading chunks/entities.
world.afterEvents.playerInventoryItemChange?.subscribe(ev=>deferredPlayer(ev.player));
world.afterEvents.playerHotbarSelectedSlotChange?.subscribe(ev=>deferredPlayer(ev.player));
world.afterEvents.playerSpawn.subscribe(ev=>deferredPlayer(ev.player));
world.afterEvents.playerInteractWithBlock.subscribe(ev=>{
 deferredPlayer(ev.player);deferredBlock(ev.block);
});
world.afterEvents.playerPlaceBlock.subscribe(ev=>deferredBlock(ev.block));
world.afterEvents.playerInteractWithEntity?.subscribe(ev=>{
 deferredPlayer(ev.player);deferredEntity(ev.target);
});
for(const signalName of ['blockContainerOpened','blockContainerClosed']){
 world.afterEvents[signalName]?.subscribe(ev=>deferredBlock(ev.block));
}
for(const signalName of ['entityContainerOpened','entityContainerClosed']){
 world.afterEvents[signalName]?.subscribe(ev=>deferredEntity(ev.entity));
}
world.afterEvents.entitySpawn.subscribe(ev=>deferredEntity(ev.entity));
world.afterEvents.entityLoad?.subscribe(ev=>deferredEntity(ev.entity));

// Always clear every online player's inventory and equipment, even if bundles
// arrive by creative inventory, commands, crafting, or item pickups.
system.runInterval(()=>{
 if(!getConfig().clearBundles)return;
 for(const p of world.getAllPlayers())safe(()=>purgePlayer(p));
},2);

// Sweep loaded nearby block inventories in small batches to catch hoppers,
// dispensers, unattended chests/barrels/furnaces, and unobserved transfers.
system.runInterval(()=>{
 const current=new Set();
 for(const p of world.getAllPlayers()){
  current.add(p.id);
  const d=p.dimension,at=p.location;
  const cx=Math.floor(at.x),cy=Math.floor(at.y),cz=Math.floor(at.z);
  let from=scanState.get(p.id)||0;
  for(let j=0;j<BATCH;j++){
   const index=(from+j)%BLOCKS;
   const dx=(index%SIDE)-HORIZONTAL;
   const dz=(Math.floor(index/SIDE)%SIDE)-HORIZONTAL;
   const dy=Math.floor(index/(SIDE*SIDE))-VERTICAL;
   purgeBlock(d,{x:cx+dx,y:cy+dy,z:cz+dz});
  }
  scanState.set(p.id,(from+BATCH)%BLOCKS);
 }
 for(const id of scanState.keys())if(!current.has(id))scanState.delete(id);
},5);

// Recheck recently accessed containers regardless of player movement.
system.runInterval(()=>{
 const now=system.currentTick;
 for(const [id,rec] of knownBlocks){
  if(now-rec.at>12000){knownBlocks.delete(id);continue;}
  const dim=safe(()=>world.getDimension(rec.dimension));
  if(dim)purgeBlock(dim,rec.pos);
 }
},20);

// Catch nearby transport entities and bundles left on the ground.
system.runInterval(()=>{
 for(const name of DIMENSIONS){
  const dim=safe(()=>world.getDimension(name));if(!dim)continue;
  for(const item of safe(()=>dim.getEntities({type:'minecraft:item'}),[]))purgeEntity(item);
 }
 for(const p of world.getAllPlayers()){
  const entities=safe(()=>p.dimension.getEntities({location:p.location,maxDistance:48}),[]);
  for(const e of entities)if(e.typeId!=='minecraft:player')purgeEntity(e);
 }
},40);
