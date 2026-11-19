import {world,system} from '@minecraft/server';
import {terrainTop} from './terrain_v184.js';

// SparkMod V232: random structure placement.
// The Spark Shrine (Temple of Sparks, 1500,1500) and the Spark Colosseum (1750,1500) stay where they
// are. Every other Spark structure now appears at a RANDOM spot that is:
//   - on the surface,
//   - in a plains biome, or near (not on top of) a village,
//   - fully inside the 5,000 x 5,000 Spark map (X and Z between -2500 and 2500),
//   - well away from the other Spark structures.
// Structures appear while players explore: a candidate spot 40-90 blocks from a player is checked
// every couple of seconds, and a structure is built there when the spot qualifies.
const BOUND=2500;
const SITES_KEY='sparkmod:v232_sites';
const FIXED=[{x:1500,z:1500,r:45,name:'Spark Shrine'},{x:1750,z:1500,r:55,name:'Spark Colosseum'}];
export const TYPES={
 tower:{structure:'sparkmod:tower_graveyard',w:64,d:50,count:10,name:'Tower and Graveyard'},
 castle:{structure:'sparkmod:spark_castle',w:40,d:40,count:4,name:'Spark Castle'},
 arena:{structure:'sparkmod:underground_pvp_arena',w:35,d:35,count:1,name:'Underground Fight Pit',rim:49}
};
const MIN_SPACING=320;               // between any two Spark structures
const PLACE_GAP_TICKS=20*45;         // at most one new structure every 45 seconds
const safe=(fn,f)=>{try{return fn();}catch(e){return f;}};

export function sites(){return safe(()=>JSON.parse(world.getDynamicProperty(SITES_KEY)||'[]'),[])||[];}
function saveSites(list){safe(()=>world.setDynamicProperty(SITES_KEY,JSON.stringify(list)));}

// Structures that older versions already built still count, at their old fixed positions.
const LEGACY_TOWERS=[[-2200,-2200],[0,-2200],[2200,-2200],[-2200,0],[2200,0],[-2200,2200],[0,2200],[2200,2200],[-1100,-2200]];
const LEGACY_CASTLES=[[1200,-1200],[-1200,1200],[1200,1200]];
function legacySites(){
 const out=[];
 LEGACY_TOWERS.forEach(([x,z],i)=>{if(world.getDynamicProperty('sparkmod:v183_structure_tower_'+i)===true)out.push({type:'tower',x,z,legacy:true});});
 LEGACY_CASTLES.forEach(([x,z],i)=>{if(world.getDynamicProperty('sparkmod:v183_structure_castle_'+(i+1))===true)out.push({type:'castle',x,z,legacy:true});});
 if(world.getDynamicProperty('sparkmod:v192_spawn_graveyard_placed')===true){
  const s=safe(()=>JSON.parse(world.getDynamicProperty('sparkmod:v192_spawn_graveyard_site')),null);
  if(s)out.push({type:'tower',x:s.x,z:s.z,legacy:true});
 }
 if(world.getDynamicProperty('sparkmod:v200_castle_spawn_placed')===true){
  const s=safe(()=>JSON.parse(world.getDynamicProperty('sparkmod:v200_castle_spawn_site')),null);
  if(s)out.push({type:'castle',x:s.x,z:s.z,legacy:true});
 }
 if(world.getDynamicProperty('sparkmod:underground_pvp_arena_v167_placed')===true&&!world.getDynamicProperty('sparkmod:v232_arena_site'))
  out.push({type:'arena',x:2000,z:1500,legacy:true});
 return out;
}
const allSites=()=>[...legacySites(),...sites()];
function remaining(){
 const placed=allSites();
 const left={};
 for(const [k,t] of Object.entries(TYPES))left[k]=Math.max(0,t.count-placed.filter(s=>s.type===k).length);
 return left;
}

// ---------------------------------------------------------------- site checks
const isPlainsBiome=id=>/plains/.test(id)&&!/snowy|ice/.test(id);
function biomeAt(dim,p){
 const b=safe(()=>dim.getBiome?.(p),null);
 return b?String(b.id||b.typeId||b):null;
}
function villagers(dim,p,r){return safe(()=>dim.getEntities({location:p,maxDistance:r,families:['villager']}),null)??safe(()=>dim.getEntities({location:p,maxDistance:r,type:'minecraft:villager_v2'}),[]);}
function surface(dim,x,z){
 const top=safe(()=>terrainTop(dim,{x,z}),null);
 if(!top)return null;
 const above=safe(()=>dim.getBlock({x,y:top.location.y+1,z}));
 if(!above||above.isLiquid)return null;                 // water / lava on top: not dry land
 if(top.isLiquid)return null;
 return {y:top.location.y,type:top.typeId};
}
function checkSite(dim,type,cx,cz){
 const t=TYPES[type],hw=Math.ceil(t.w/2)+2,hd=Math.ceil(t.d/2)+2;
 if(Math.abs(cx)+hw>BOUND||Math.abs(cz)+hd>BOUND)return null;               // stay inside 5k x 5k
 for(const f of FIXED)if(Math.hypot(cx-f.x,cz-f.z)<f.r+Math.max(t.w,t.d)+60)return null;
 for(const s of allSites())if(Math.hypot(cx-s.x,cz-s.z)<MIN_SPACING)return null;
 // Footprint must be loaded and reasonably flat dry land.
 const pts=[[cx,cz],[cx-hw,cz-hd],[cx+hw,cz-hd],[cx-hw,cz+hd],[cx+hw,cz+hd],[cx,cz-hd],[cx,cz+hd],[cx-hw,cz],[cx+hw,cz]];
 const ys=[];
 for(const [x,z] of pts){const s=surface(dim,Math.floor(x),Math.floor(z));if(!s)return null;ys.push(s.y);}
 ys.sort((a,b)=>a-b);
 if(ys[ys.length-1]-ys[0]>4)return null;               // V233: only fairly flat ground
 const y=ys[Math.floor(ys.length/2)];
 // Plains, or near a village (but never on top of one).
 const center={x:cx,y:y+1,z:cz};
 if(villagers(dim,center,Math.max(t.w,t.d)/2+18).length)return null;
 const biome=biomeAt(dim,center);
 const plains=biome?isPlainsBiome(biome):/grass_block/.test(safe(()=>surface(dim,cx,cz).type,''));
 const nearVillage=villagers(dim,center,140).length>0;
 if(!plains&&!nearVillage)return null;
 return {y,biome,nearVillage};
}

// ---------------------------------------------------------------- placement
let nextPlace=0;
function place(dim,type,cx,cz,info){
 const t=TYPES[type];
 const ox=Math.floor(cx-t.w/2),oz=Math.floor(cz-t.d/2);
 let y=info.y+1;
 if(type==='arena')y=Math.max(-64,info.y-t.rim);             // pit opens at the surface
 world.structureManager.place(t.structure,dim,{x:ox,y,z:oz});
 if(type==='castle'){                                         // remove the authoring marker in the castle file
  const m=safe(()=>dim.getBlock({x:ox,y:y+1,z:oz}));
  if(m?.typeId==='minecraft:structure_block')safe(()=>m.setType('minecraft:air'));
 }
 const rec={type,x:Math.floor(cx),z:Math.floor(cz),y,w:t.w,d:t.d,biome:info.biome,village:info.nearVillage,blended:true};
 saveSites([...sites(),rec]);
 if(type==='arena'){
  world.setDynamicProperty('sparkmod:v232_arena_site',JSON.stringify(rec));
  world.setDynamicProperty('sparkmod:underground_pvp_arena_v167_surface_y',y+t.rim);
  world.setDynamicProperty('sparkmod:underground_pvp_arena_v167_placed',true);
 }
 blendIn(dim,rec,type==='arena'?y+t.rim:y-1,type==='arena'?y+t.rim+1:y);
 for(const p of dim.getPlayers())if(Math.hypot(p.location.x-cx,p.location.z-cz)<160)
  safe(()=>p.sendMessage(`§6⚡ A ${t.name} has appeared${info.nearVillage?' near a village':' on the plains'} at X ${rec.x}, Z ${rec.z}!`));
 console.warn(`[SparkMod V232] ${t.name} placed at ${rec.x},${y},${rec.z} (${info.biome||'biome n/a'})`);
}
system.runInterval(()=>{
 if(system.currentTick<nextPlace)return;
 const left=remaining();
 const types=Object.keys(left).filter(k=>left[k]>0);
 if(!types.length)return;
 const dim=safe(()=>world.getDimension('overworld'));if(!dim)return;
 for(const p of dim.getPlayers()){
  // Most-needed type first, with a little randomness.
  const type=types.sort((a,b)=>left[b]-left[a]+(Math.random()-.5))[0];
  for(let attempt=0;attempt<3;attempt++){
   const a=Math.random()*Math.PI*2,r=40+Math.random()*50;
   const cx=Math.floor(p.location.x+Math.cos(a)*r),cz=Math.floor(p.location.z+Math.sin(a)*r);
   const info=safe(()=>checkSite(dim,type,cx,cz),null);
   if(!info)continue;
   try{place(dim,type,cx,cz,info);nextPlace=system.currentTick+PLACE_GAP_TICKS;return;}
   catch(e){console.warn('[SparkMod V232] placement failed, will retry elsewhere: '+e);}
  }
 }
},40);

// ---------------------------------------------------------------- V233/V243: blend into the terrain
// After a structure is placed (or once for structures that already exist): fill everything under it
// down to the real ground, then shape a natural earth slope around it that meets the surrounding
// terrain. The slope grows with the height difference (a structure on a hilltop gets a whole
// hillside), trees cut by the build lose their floating leaves, and new ground gets grass/flowers.
const PLANT=/leaves|log|wood|short_grass|tall_grass|tallgrass|fern|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose|peony|lilac|sunflower|bush|vine|mushroom|snow_layer|petals/;
const SOFT=b=>!b||b.isAir||b.isLiquid||PLANT.test(b.typeId);
const FLOWERS=['minecraft:poppy','minecraft:dandelion','minecraft:cornflower','minecraft:oxeye_daisy','minecraft:azure_bluet'];
const hash=(x,z)=>{let h=(x*374761393+z*668265263)|0;h=(h^(h>>>13))*1274126177|0;return ((h^(h>>>16))>>>0)/4294967295;};
function setType(dim,p,id){const b=safe(()=>dim.getBlock(p));if(b)safe(()=>b.setType(id));return !!b;}
function fillCol(dim,x,y1,y2,z,id){if(y2<y1)return;safe(()=>dim.runCommand(`fill ${x} ${y1} ${z} ${x} ${y2} ${z} ${id}`));}
function naturalTop(dim,x,z,around,span=40){
 for(let y=around+span;y>=around-span;y--){const b=safe(()=>dim.getBlock({x,y,z}));if(!b)return null;if(!SOFT(b))return y;}
 return null;
}
// groundY: the structure's own ground surface; baseY: the lowest layer of the structure itself.
export function blendIn(dim,rec,groundY,baseY=groundY+1){
 const ox=Math.floor(rec.x-rec.w/2),oz=Math.floor(rec.z-rec.d/2),ex=ox+rec.w,ez=oz+rec.d;
 // How far does the ground around it differ? The slope widens to keep it gentle.
 let diff=0;
 for(let i=0;i<24;i++){
  const t=i/24,side=i%4;
  const x=side<2?Math.round(ox+(ex-ox)*t):(side===2?ox-3:ex+2);
  const z=side<2?(side===0?oz-3:ez+2):Math.round(oz+(ez-oz)*t);
  const top=naturalTop(dim,x,z,groundY);
  if(top!==null)diff=Math.max(diff,Math.abs(top-groundY));
 }
 const ring=Math.max(7,Math.min(36,Math.ceil(diff*1.7)+4));
 const cols=[];
 for(let x=ox-ring;x<ex+ring;x++)for(let z=oz-ring;z<ez+ring;z++){
  const inside=x>=ox&&x<ex&&z>=oz&&z<ez;
  if(inside&&rec.type==='arena')continue;           // the pit itself stays open
  const e=Math.max(ox-x,x-(ex-1),oz-z,z-(ez-1),0); // distance out from the footprint edge
  if(e>0&&Math.hypot(Math.max(0,ox-x,x-(ex-1)),Math.max(0,oz-z,z-(ez-1)))>ring)continue;  // rounded corners
  cols.push({x,z,e,inside});
 }
 let i=0;
 const step=()=>{
  for(let n=0;n<200&&i<cols.length;n++,i++)safe(()=>blendColumn(dim,cols[i],groundY,baseY,ring,rec));
  if(i<cols.length)system.runTimeout(step,1);
 };
 system.runTimeout(step,2);
}
function blendColumn(dim,c,groundY,baseY,ring,rec){
 const {x,z,inside}=c;
 if(inside){                                       // foundation: solid all the way down to real ground
  let y=baseY-1,bottom=y;
  for(let k=0;k<90;k++,y--){const b=safe(()=>dim.getBlock({x,y,z}));if(!b||!SOFT(b))break;bottom=y;}
  if(bottom<=baseY-1)fillCol(dim,x,bottom,baseY-1,z,'minecraft:dirt');
  return;
 }
 const e=Math.hypot(Math.max(0,Math.floor(rec.x-rec.w/2)-x,x-(Math.floor(rec.x-rec.w/2)+rec.w-1)),Math.max(0,Math.floor(rec.z-rec.d/2)-z,z-(Math.floor(rec.z-rec.d/2)+rec.d-1)));
 const top=naturalTop(dim,x,z,groundY);
 if(top===null)return;
 const surfaceBlock=safe(()=>dim.getBlock({x,y:top+1,z}));
 if(surfaceBlock?.isLiquid)return;                 // never build into water
 // Smooth slope from the structure's ground out to the natural ground, with occasional bumps.
 const k=Math.min(1,e/(ring+1)),ease=k*k*(3-2*k);
 const jitter=hash(x,z)<.14?1:0;
 const target=Math.round(groundY+(top-groundY)*ease)+(e>1&&e<ring&&Math.abs(top-groundY)<=1?jitter:0);
 if(top<target){
  fillCol(dim,x,top+1,target-1,z,'minecraft:dirt');
  setType(dim,{x,y:target,z},'minecraft:grass_block');
  const below=safe(()=>dim.getBlock({x,y:top,z}));
  if(below?.typeId==='minecraft:grass_block')setType(dim,{x,y:top,z},'minecraft:dirt');
 }else if(top>target){
  fillCol(dim,x,target+1,top,z,'minecraft:air');
  setType(dim,{x,y:target,z},'minecraft:grass_block');
 }
 // Clear floating leaves/logs of trees the structure cut through (close to it only).
 if(e<=4)for(let y=target+1;y<=target+18;y++){
  const b=safe(()=>dim.getBlock({x,y,z}));if(!b)break;
  if(/leaves|log/.test(b.typeId))setType(dim,{x,y,z},'minecraft:air');
 }
 // Fresh plants on the newly shaped ground.
 const above=safe(()=>dim.getBlock({x,y:target+1,z}));
 const ground=safe(()=>dim.getBlock({x,y:target,z}));
 if(above?.isAir&&ground?.typeId==='minecraft:grass_block'&&top!==target){
  const r=hash(x*3,z*7);
  if(r<.04)setType(dim,{x,y:target+1,z},FLOWERS[Math.floor(hash(z,x*5)*FLOWERS.length)]);
  else if(r<.32)setType(dim,{x,y:target+1,z},'minecraft:short_grass');
 }
}
// V243: blend the fixed structures (Spark Colosseum, Spark Shrine) and every structure that was
// built before blending existed - once each, when a player is close enough for it to be loaded.
const BLENDED='sparkmod:v243_blended';
function blendedSet(){return new Set(safe(()=>JSON.parse(world.getDynamicProperty(BLENDED)||'[]'),[]));}
function retrofitTargets(){
 const out=[];
 const cy=world.getDynamicProperty('sparkmod:colosseum_sparks_v182_y');
 if(world.getDynamicProperty('sparkmod:colosseum_sparks_v182_placed')===true&&typeof cy==='number')
  out.push({key:'colosseum',rec:{type:'colosseum',x:1750,z:1500,w:64,d:50},groundY:cy+2,baseY:cy});
 const ty=world.getDynamicProperty('sparkmod:temple_surface_y');
 if(world.getDynamicProperty('sparkmod:temple_custom_v166_placed')===true&&typeof ty==='number')
  out.push({key:'shrine',rec:{type:'shrine',x:1500,z:1500,w:50,d:25},groundY:ty,baseY:ty-4});
 for(const s of sites())if(s.type!=='arena'&&!s.blended)out.push({key:'site_'+s.x+'_'+s.z,rec:s,groundY:s.y-1,baseY:s.y});
 return out;
}
system.runInterval(()=>{
 const dim=safe(()=>world.getDimension('overworld'));if(!dim)return;
 const done=blendedSet();
 for(const t of retrofitTargets()){
  if(done.has(t.key))continue;
  const near=dim.getPlayers().some(p=>Math.hypot(p.location.x-t.rec.x,p.location.z-t.rec.z)<70);
  if(!near)continue;
  const corners=[[t.rec.x-t.rec.w/2-20,t.rec.z-t.rec.d/2-20],[t.rec.x+t.rec.w/2+20,t.rec.z+t.rec.d/2+20]];
  if(corners.some(([x,z])=>!safe(()=>dim.getBlock({x:Math.floor(x),y:t.groundY,z:Math.floor(z)}))))continue;
  done.add(t.key);safe(()=>world.setDynamicProperty(BLENDED,JSON.stringify([...done])));
  blendIn(dim,t.rec,t.groundY,t.baseY);
  for(const p of dim.getPlayers())if(Math.hypot(p.location.x-t.rec.x,p.location.z-t.rec.z)<90)
   safe(()=>p.sendMessage('§7⚡ The land around the '+(t.key==='colosseum'?'Spark Colosseum':t.key==='shrine'?'Spark Shrine':'Spark structure')+' is settling into the terrain...'));
  return;   // one at a time
 }
},100);
// /scriptevent sparkmod:structures - list where the Spark structures are.
system.afterEvents.scriptEventReceive.subscribe(ev=>{
 if(ev.id!=='sparkmod:structures'||ev.sourceEntity?.typeId!=='minecraft:player')return;
 const p=ev.sourceEntity;
 if(safe(()=>p.playerPermissionLevel,2)<2){safe(()=>p.sendMessage('§cOnly operators can list structure locations - go explore the plains!'));return;}
 system.run(()=>{
  safe(()=>p.sendMessage('§6⚡ Spark structures:'));
  for(const f of FIXED)safe(()=>p.sendMessage(`§e${f.name}: §fX ${f.x}, Z ${f.z}`));
  for(const s of allSites())safe(()=>p.sendMessage(`§e${TYPES[s.type]?.name||s.type}: §fX ${s.x}, Z ${s.z}`));
  const left=remaining();
  safe(()=>p.sendMessage('§7Still to be found: '+Object.entries(left).filter(([,n])=>n>0).map(([k,n])=>`${n} ${TYPES[k].name}`).join(', ')||'none'));
 });
});
