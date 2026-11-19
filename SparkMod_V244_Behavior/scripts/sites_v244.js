import {world,system} from '@minecraft/server';

// SparkMod V244: where the Spark Colosseum and the Spark Shrine go.
// They keep their classic spots (Colosseum X 1750 Z 1500, Shrine X 1500 Z 1500) when those are on land.
// If ocean or river is there, the structure moves to the nearest plains instead - always fully inside
// the 5,000 x 5,000 Spark map (X and Z between -2500 and 2500) and well away from the other one.
// Structures that are already built never move. Every other script reads the position from here.
const BOUND=2500;
const DEFAULTS={
 colosseum:{x:1750,z:1500,w:64,d:50,flag:'sparkmod:colosseum_sparks_v182_placed',name:'Spark Colosseum'},
 shrine:{x:1500,z:1500,w:50,d:25,flag:'sparkmod:temple_custom_v166_placed',name:'Spark Shrine'}
};
const WATER_BIOMES=['minecraft:ocean','minecraft:deep_ocean','minecraft:warm_ocean','minecraft:lukewarm_ocean',
 'minecraft:deep_lukewarm_ocean','minecraft:cold_ocean','minecraft:deep_cold_ocean','minecraft:frozen_ocean',
 'minecraft:deep_frozen_ocean','minecraft:river','minecraft:frozen_river'];
const key=n=>'sparkmod:v244_site_'+n;
const safe=(fn,f)=>{try{return fn();}catch(e){return f;}};

// The resolved site, or null while it is still being worked out.
export function getSite(name){
 const s=safe(()=>JSON.parse(world.getDynamicProperty(key(name))||'null'),null);
 return s&&Number.isFinite(s.x)&&Number.isFinite(s.z)?s:null;
}
// Always returns a position (the classic spot until the real one is known).
export function siteOf(name){const s=getSite(name)||DEFAULTS[name];return {x:s.x,z:s.z,moved:!!s.moved};}
export const SITE_SIZE=Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,{w:v.w,d:v.d}]));

function findBiome(dim,pos,id,size){
 return safe(()=>dim.findClosestBiome({x:pos.x,y:64,z:pos.z},id,{boundingSize:{x:size,y:64,z:size}}),undefined);
}
const biomeApi=dim=>typeof dim?.findClosestBiome==='function';
function waterAt(dim,def,pos){
 const size=Math.max(def.w,def.d)+40;
 for(const id of WATER_BIOMES){
  const hit=findBiome(dim,pos,id,size);
  if(hit&&Math.abs(hit.x-pos.x)<=size/2&&Math.abs(hit.z-pos.z)<=size/2)return true;
 }
 return false;
}
const inside=(def,p)=>Math.abs(p.x)+def.w/2+40<=BOUND&&Math.abs(p.z)+def.d/2+40<=BOUND;
const LAND_BIOMES=['minecraft:meadow','minecraft:forest','minecraft:birch_forest','minecraft:flower_forest','minecraft:savanna',
 'minecraft:taiga','minecraft:dark_forest','minecraft:jungle','minecraft:desert','minecraft:snowy_plains'];
function findPlains(dim,def,avoid,biomes=['minecraft:plains','minecraft:sunflower_plains']){
 const anchors=[{x:def.x,z:def.z},{x:0,z:0},{x:1200,z:1200},{x:-1200,z:1200},{x:1200,z:-1200},{x:-1200,z:-1200},{x:0,z:1800},{x:1800,z:0},{x:0,z:-1800},{x:-1800,z:0}];
 const found=[];
 for(const a of anchors){
  for(const id of biomes){
   const hit=findBiome(dim,a,id,2400);
   if(!hit)continue;
   // Step a little into the biome so the whole footprint sits on plains, not on its edge.
   let p={x:Math.round(hit.x),z:Math.round(hit.z)};
   // Step deeper into the biome, away from the water, when the biome continues that way.
   const dx=p.x-def.x,dz=p.z-def.z,l=Math.hypot(dx,dz);
   if(l>1){const q={x:Math.round(p.x+dx/l*48),z:Math.round(p.z+dz/l*48)};
    const deeper=findBiome(dim,q,id,10);if(deeper&&inside(def,q))p=q;}
   if(!inside(def,p))continue;
   if(avoid&&Math.hypot(p.x-avoid.x,p.z-avoid.z)<220)continue;
   if(waterAt(dim,def,p))continue;
   found.push(p);
  }
 }
 found.sort((a,b)=>Math.hypot(a.x-def.x,a.z-def.z)-Math.hypot(b.x-def.x,b.z-def.z));
 return found[0]||null;
}
function resolve(name,otherName){
 if(getSite(name))return true;
 const def=DEFAULTS[name],dim=safe(()=>world.getDimension('overworld'));
 if(!dim)return false;
 const keep=()=>{world.setDynamicProperty(key(name),JSON.stringify({x:def.x,z:def.z}));return true;};
 if(world.getDynamicProperty(def.flag)===true)return keep();          // already built: never move it
 if(!biomeApi(dim)){console.warn('[SparkMod V244] Biome search unavailable; '+def.name+' stays at its classic spot.');return keep();}
 if(!waterAt(dim,def,def))return keep();                                // classic spot is on land
 const other=getSite(otherName);
 let p=findPlains(dim,def,other);
 if(!p){p=findPlains(dim,def,other,LAND_BIOMES);if(p)console.warn('[SparkMod V244] No plains in range for '+def.name+'; using the nearest dry land.');}
 if(!p){console.warn('[SparkMod V244] No dry land found for '+def.name+' inside the Spark map; keeping the classic spot.');return keep();}
 world.setDynamicProperty(key(name),JSON.stringify({x:p.x,z:p.z,moved:true}));
 console.warn(`[SparkMod V244] ${def.name} moved off the water to plains at ${p.x}, ${p.z}.`);
 return true;
}
let tries=0;
const timer=system.runInterval(()=>{
 const a=safe(()=>resolve('colosseum','shrine'),false);
 const b=safe(()=>resolve('shrine','colosseum'),false);
 if((a&&b)||++tries>30)system.clearRun(timer);
},40);
