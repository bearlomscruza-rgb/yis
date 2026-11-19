import {world,system,InputPermissionCategory,EquipmentSlot} from '@minecraft/server';
import {getConfig} from './spark_config.js';

// V209: keep Spark enchantment caps; replace locator-map penalties with map cleanup.
const UNUSED_LOCK_KEY='sparkmod:locator_map_lock_until';
const PREV_MOVE='sparkmod:locator_map_prev_move';
const PENALTY_MS=30_000;
const EVIDENCE_MS=12_000;
const evidence=new Map();
const safe=(fn,fallback)=>{try{return fn();}catch(e){console.warn('[SparkMod V207] '+String(e));return fallback;}};
const eqSlots=[EquipmentSlot.Head,EquipmentSlot.Chest,EquipmentSlot.Legs,EquipmentSlot.Feet,EquipmentSlot.Mainhand];
const armor=new Set([
 'sparkmod:god_helmet','sparkmod:god_helmet_v3',
 'sparkmod:god_chestplate','sparkmod:god_chestplate_v3',
 'sparkmod:god_leggings','sparkmod:god_leggings_v3',
 'sparkmod:god_boots','sparkmod:god_boots_v3'
]);
const swords=new Set(['sparkmod:spark_sword','sparkmod:awakened_spark_sword']);
function clampEnchantments(stack){
 if(!stack)return false;
 const allowed=armor.has(stack.typeId)?'protection':swords.has(stack.typeId)?'sharpness':null;
 if(!allowed)return false;
 const enchantable=safe(()=>stack.getComponent('minecraft:enchantable'));
 if(!enchantable)return false;
 const all=safe(()=>enchantable.getEnchantments(),[]);
 let changed=false;
 for(const enchant of all){
  const id=String(enchant.type?.id||'').replace(/^minecraft:/,'');
  if(id!==allowed)continue;
  const limit=allowed==='protection'?2:3;
  if(enchant.level<=limit)continue;
  const success=safe(()=>{
   enchantable.removeEnchantment(enchant.type);
   enchantable.addEnchantment({type:enchant.type,level:limit});
   return true;
  },false);
  if(success)changed=true;
 }
 return changed;
}
function scanSparkEnchants(player){
 const inv=safe(()=>player.getComponent('minecraft:inventory')?.container);
 if(inv)for(let i=0;i<inv.size;i++){
  const stack=safe(()=>inv.getItem(i));
  if(stack && clampEnchantments(stack))safe(()=>inv.setItem(i,stack));
 }
 const eq=safe(()=>player.getComponent('minecraft:equippable'));
 if(eq)for(const slot of eqSlots){
  const stack=safe(()=>eq.getEquipment(slot));
  if(stack && clampEnchantments(stack))safe(()=>eq.setEquipment(slot,stack));
 }
}

// Bedrock stores ordinary and locator maps under the same item identifiers;
// current stable ItemStack API does not expose the map's auxiliary data value.
// We remove BOTH variants rather than mistakenly keeping locator maps.
const MAPS=new Set(['minecraft:empty_map','minecraft:filled_map','minecraft:map']);
// V229: can be switched off with /deck3.
const isMap=stack=>!!stack && MAPS.has(stack.typeId) && getConfig().clearLocatorMaps;
function clearContainer(container){
 if(!container)return;
 for(let slot=0;slot<container.size;slot++){
  const item=safe(()=>container.getItem(slot));
  if(isMap(item))safe(()=>container.setItem(slot,undefined));
 }
}
function unlockOldPenalty(player){
 // Undo remaining restrictions from V207/V208 when activating this update.
 const oldMove=safe(()=>player.getDynamicProperty('sparkmod:locator_map_prev_move'));
 if(typeof oldMove==='boolean'){
  // Avoid unfreezing a player with an active Titan stun.
  const stun=safe(()=>JSON.parse(player.getDynamicProperty('sparkmod:titan_stun')||'null'));
  if(!stun || Number(stun.until)<=Date.now())safe(()=>player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement,oldMove));
 }
 safe(()=>player.setDynamicProperty('sparkmod:locator_map_prev_move',undefined));
 safe(()=>player.setDynamicProperty('sparkmod:locator_map_lock_until',undefined));
}
function cleanPlayer(player){
 unlockOldPenalty(player);
 scanSparkEnchants(player);
 clearContainer(safe(()=>player.getComponent('minecraft:inventory')?.container));
 const eq=safe(()=>player.getComponent('minecraft:equippable'));
 if(eq)for(const slot of [EquipmentSlot.Mainhand,EquipmentSlot.Offhand]){
  const item=safe(()=>eq.getEquipment(slot));
  if(isMap(item))safe(()=>eq.setEquipment(slot,undefined));
 }
}
function cleanAround(player){
 const dim=player.dimension;
 for(const e of safe(()=>dim.getEntities({location:player.location,maxDistance:24}),[])){
  if(e.typeId==='minecraft:item'){
   const item=safe(()=>e.getComponent('minecraft:item')?.itemStack);
   if(isMap(item))safe(()=>e.remove());
  }else if(e.typeId!=='minecraft:player')clearContainer(safe(()=>e.getComponent('minecraft:inventory')?.container));
 }
 // Inspect accessible storage near loaded player chunks.
 const cx=Math.floor(player.location.x),cy=Math.floor(player.location.y),cz=Math.floor(player.location.z);
 for(let x=cx-4;x<=cx+4;x++)for(let y=cy-2;y<=cy+2;y++)for(let z=cz-4;z<=cz+4;z++){
  const block=safe(()=>dim.getBlock({x,y,z}));
  if(block)clearContainer(safe(()=>block.getComponent('minecraft:inventory')?.container));
 }
}
world.afterEvents.playerSpawn.subscribe(({player})=>system.runTimeout(()=>safe(()=>cleanPlayer(player)),5));
if(world.afterEvents.playerInventoryItemChange?.subscribe)world.afterEvents.playerInventoryItemChange.subscribe(({player})=>system.runTimeout(()=>safe(()=>cleanPlayer(player)),1));
system.runInterval(()=>{
 for(const p of world.getAllPlayers())safe(()=>cleanPlayer(p));
},4);
system.runInterval(()=>{
 if(!getConfig().clearLocatorMaps)return;
 for(const p of world.getAllPlayers())safe(()=>cleanAround(p));
},20);
