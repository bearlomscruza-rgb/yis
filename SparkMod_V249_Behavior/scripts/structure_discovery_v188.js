// V188: Announce the player's own coordinates when entering a MAIN Spark structure.
// Called after startup. No worldwide broadcast of a player's location.
import {world,system} from '@minecraft/server';
import {siteOf} from './sites_v244.js';
const SITES=[
 {name:'TEMPLE OF SPARKS',x:1500,z:1500,r:44,flag:'sparkmod:temple_custom_v166_placed'},
 {name:'COLOSSEUM OF SPARKS',x:1750,z:1500,r:53,flag:'sparkmod:colosseum_sparks_v182_placed'},
 {name:'UNDERGROUND FIGHT PIT',x:2000,z:1500,r:38,flag:'sparkmod:underground_pvp_arena_v167_placed'}
];
// V232: the fight pit now has a random location.
function arenaSite(){
 const sh=siteOf('shrine'),co=siteOf('colosseum');SITES[0].x=sh.x;SITES[0].z=sh.z;SITES[1].x=co.x;SITES[1].z=co.z;try{const s=JSON.parse(world.getDynamicProperty('sparkmod:v232_arena_site')||'null');if(s){SITES[2].x=s.x;SITES[2].z=s.z;}}catch{}}
const insideByPlayer=new Map();
const lastRevealByPlayer=new Map();
const msgLoc=p=>{const a=p.location;return `X: ${Math.floor(a.x)}   Y: ${Math.floor(a.y)}   Z: ${Math.floor(a.z)}`;};
system.runInterval(()=>{
 try{
  arenaSite();
  const online=new Set();
  for(const p of world.getDimension('overworld').getPlayers()){
   online.add(p.id);
   const discovered=insideByPlayer.get(p.id)||new Set();
   const nowInside=new Set();
   for(const s of SITES){
    if(world.getDynamicProperty(s.flag)!==true)continue;
    const dx=p.location.x-s.x, dz=p.location.z-s.z;
    if(dx*dx+dz*dz>s.r*s.r)continue;
    nowInside.add(s.name);
    if(discovered.has(s.name))continue;
    const key=p.id+':'+s.name;
    if(system.currentTick-(lastRevealByPlayer.get(key)||-10000)<100)continue;
    lastRevealByPlayer.set(key,system.currentTick);
    const coordinates=msgLoc(p);
    p.onScreenDisplay.setTitle('§6§lYOUR COORDS',{subtitle:'§f§l'+coordinates,fadeInDuration:5,stayDuration:100,fadeOutDuration:20});
    p.sendMessage('§6§l'+s.name+' FOUND!');
    p.sendMessage('§e§lYOUR COORDS: §f§l'+coordinates);
   }
   insideByPlayer.set(p.id,nowInside);
  }
  for(const id of insideByPlayer.keys())if(!online.has(id))insideByPlayer.delete(id);
 }catch(e){console.warn('[SparkMod V188 discovery] '+e);}
},20);
