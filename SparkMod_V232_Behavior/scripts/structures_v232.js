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
 if(ys[ys.length-1]-ys[0]>7)return null;
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
 const rec={type,x:Math.floor(cx),z:Math.floor(cz),y,w:t.w,d:t.d,biome:info.biome,village:info.nearVillage};
 saveSites([...sites(),rec]);
 if(type==='arena'){
  world.setDynamicProperty('sparkmod:v232_arena_site',JSON.stringify(rec));
  world.setDynamicProperty('sparkmod:underground_pvp_arena_v167_surface_y',y+t.rim);
  world.setDynamicProperty('sparkmod:underground_pvp_arena_v167_placed',true);
 }
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
