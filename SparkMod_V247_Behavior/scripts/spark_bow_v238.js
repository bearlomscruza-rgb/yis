import {world,system,ItemStack,EquipmentSlot,WeatherType} from '@minecraft/server';
import * as F from './titan_fx_v217.js';
import {stun} from './bolt_titan.js';
import {inside as protectedArea} from './structure_protection.js';

// SparkMod V238 - SPARK BOW
// A vanilla bow carrying the Spark mark. Once AWAKENED at the Spark Shrine it gains STORM JUDGMENT:
//  - Sneak while drawing the awakened, charged bow to start the ritual: the sky darkens, a thunderstorm
//    rolls in, lightning strikes in a circle around you and glowing runes cover the ground.
//    The ritual costs 5 hearts, locked away for 30 seconds.
//  - Release to fire a colossal beam (3x a beacon beam) at the creature/player you're aiming at.
//    It deals 10 hearts straight through Protection IV and blasts a crater down to bedrock.
//    A survivor can't move for 5 seconds and has Weakness III for 10 minutes.
//  - Then the bow is SPENT: reactivate it at the Spark Shrine (10 Spark Tokens) and wait out the
//    10-minute cooldown before using it again.
const MARK='§8SparkMod: Spark Bow';
const COOLDOWN_MS=10*60*1000;
const HEART_LOCK_MS=30000;
const RITUAL_TICKS=20*15;           // the ritual waits up to 15 s for the shot
const safe=(fn,f)=>{try{return fn();}catch(e){return f;}};
const tell=(p,m)=>safe(()=>p.sendMessage(m));
let host={isAlly:()=>false,take:()=>false,count:()=>0,moon:()=>({active:false}),setMoonUsed:()=>{},moonUsed:()=>false};
export function initSparkBow(h){host={...host,...h};}

// V243: the Spark Bow is its own item (sparkmod:spark_bow) with its own glowing pale-gold design.
const legacyBow=item=>item?.typeId==='minecraft:bow'&&(safe(()=>item.getDynamicProperty('sparkmod:spark_bow'),false)===true||!!safe(()=>item.getLore().includes(MARK),false));
export const isSparkBow=item=>item?.typeId==='sparkmod:spark_bow'||legacyBow(item);
// Turn older vanilla-bow Spark Bows into the new item, keeping everything about them.
function upgradeBow(old){
 const bow=new ItemStack('sparkmod:spark_bow',1);
 for(const k of ['sparkmod:spark_bow','sparkmod:awakened','sparkmod:bow_spent','sparkmod:bow_ready_at'])safe(()=>{const v=old.getDynamicProperty(k);if(v!==undefined)bow.setDynamicProperty(k,v);});
 safe(()=>bow.setDynamicProperty('sparkmod:spark_bow',true));
 for(const e of safe(()=>old.getComponent('minecraft:enchantable')?.getEnchantments(),[]))safe(()=>bow.getComponent('minecraft:enchantable')?.addEnchantment(e));
 safe(()=>{const a=old.getComponent('minecraft:durability'),b=bow.getComponent('minecraft:durability');b.damage=Math.round(a.damage/a.maxDurability*b.maxDurability);});
 if(old.nameTag)bow.nameTag=old.nameTag;
 safe(()=>bow.setLore(old.getLore()));
 return bow;
}
system.runInterval(()=>{
 for(const p of world.getAllPlayers()){
  const inv=safe(()=>p.getComponent('minecraft:inventory').container);
  for(let i=0;i<(inv?.size??0);i++){const it=safe(()=>inv.getItem(i));if(legacyBow(it))safe(()=>inv.setItem(i,upgradeBow(it)));}
  const eq=safe(()=>p.getComponent('minecraft:equippable'));
  for(const s of [EquipmentSlot.Mainhand,EquipmentSlot.Offhand]){const it=safe(()=>eq.getEquipment(s));if(legacyBow(it))safe(()=>eq.setEquipment(s,upgradeBow(it)));}
 }
},40);
const heldBow=p=>{const it=safe(()=>p.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Mainhand));return isSparkBow(it)?it:null;};
const NOT_TARGET=new Set(['minecraft:item','minecraft:xp_orb','minecraft:lightning_bolt','minecraft:arrow','sparkmod:sky_beam']);
const writeHeld=(p,it)=>safe(()=>p.getComponent('minecraft:equippable').setEquipment(EquipmentSlot.Mainhand,it));
const awakened=it=>safe(()=>it.getDynamicProperty('sparkmod:awakened'),false)===true;
const spent=it=>safe(()=>it.getDynamicProperty('sparkmod:bow_spent'),false)===true;
const readyAt=it=>Number(safe(()=>it.getDynamicProperty('sparkmod:bow_ready_at'),0)||0);

// ---------------------------------------------------------------- Spark Shrine actions
export function forgeSparkBow(p){
 const inv=safe(()=>p.getComponent('minecraft:inventory').container);
 let slot=-1;
 for(let i=0;i<(inv?.size??0);i++){const it=inv.getItem(i);if(it?.typeId==='minecraft:bow'&&!isSparkBow(it)){slot=i;break;}}
 if(slot<0){tell(p,'§cBring a normal bow to forge into a Spark Bow.');return;}
 if(host.count(p)<8){tell(p,'§cForging a Spark Bow costs 8 Spark Tokens.');return;}
 if(!host.take(p,8)){tell(p,'§cPayment failed.');return;}
 const bow=new ItemStack('sparkmod:spark_bow',1);
 bow.nameTag='§6⚡ Spark Bow';
 safe(()=>bow.setLore([MARK,'§7Awaken it at the Spark Shrine to unlock §6Storm Judgment']));
 safe(()=>bow.setDynamicProperty('sparkmod:spark_bow',true));
 inv.setItem(slot,bow);
 const d=p.dimension,c={x:p.location.x,y:p.location.y+1,z:p.location.z};
 F.converge(d,c,3,30,F.C.gold);F.flash(d,c,4,F.C.gold);F.sfx(d,'sparkmod.titan.reboot',c,2,1.4);
 tell(p,'§6⚡ Spark Bow forged! Awaken it at the Spark Shrine during a Spark Moon to unlock Storm Judgment.');
}
export function awakenSparkBow(p){
 const bow=heldBow(p);
 if(!bow){tell(p,'§cHold your Spark Bow in your main hand.');return;}
 if(awakened(bow)){tell(p,'§eYour Spark Bow is already awakened.');return;}
 const moon=host.moon();
 if(!moon.active){tell(p,'§cBow awakening requires an active Spark Moon.');return;}
 if(host.count(p)<5){tell(p,'§cYou need 5 Spark Tokens to awaken the bow.');return;}
 if(!host.take(p,5))return;
 safe(()=>bow.setDynamicProperty('sparkmod:awakened',true));
 bow.nameTag='§6⚡ Awakened Spark Bow';
 safe(()=>bow.setLore([MARK,'§6Storm Judgment: §esneak while drawing, then release','§7Recharge at the Spark Shrine after each use']));
 writeHeld(p,bow);host.setMoonUsed(p,moon);
 const d=p.dimension,c={x:p.location.x,y:p.location.y+1,z:p.location.z};
 for(let k=0;k<6;k++)system.runTimeout(()=>F.pulse(d,c,4+k*3,F.C.gold,.6),k*3);
 F.sfx(d,'sparkmod.titan.godmode',c,3,1.3);
 safe(()=>host.onAwaken?.(p));
 tell(p,'§6⚡ Spark Bow awakened! STORM JUDGMENT unlocked: sneak while drawing the bow, then release.');
}
export function rechargeSparkBow(p){
 const bow=heldBow(p);
 if(!bow){tell(p,'§cHold your Spark Bow in your main hand.');return;}
 if(!awakened(bow)){tell(p,'§cAwaken the Spark Bow first.');return;}
 if(!spent(bow)){tell(p,'§eYour Spark Bow is already active.');return;}
 if(host.count(p)<10){tell(p,'§cReactivating the Spark Bow costs 10 Spark Tokens.');return;}
 if(!host.take(p,10))return;
 safe(()=>bow.setDynamicProperty('sparkmod:bow_spent',false));
 writeHeld(p,bow);
 const left=readyAt(bow)-Date.now();
 F.sfx(p.dimension,'sparkmod.titan.reboot',p.location,2,1.2);
 tell(p,'§6⚡ Spark Bow reactivated!'+(left>0?` §7Storm Judgment is ready in ${Math.ceil(left/60000)} min.`:''));
}
export function sparkBowShrineLabel(p){
 const bow=heldBow(p);
 if(!bow)return null;
 if(!awakened(bow))return '§6⚡ Awaken Held Spark Bow — 5 Tokens';
 if(spent(bow))return '§6⚡ Reactivate Spark Bow — 10 Tokens';
 return '§7Spark Bow: active';
}

// ---------------------------------------------------------------- Storm Judgment
const rituals=new Map(); // player id -> {start, ring}
world.afterEvents.itemStartUse?.subscribe(({source:p,itemStack})=>{
 if(p?.typeId!=='minecraft:player'||!isSparkBow(itemStack))return;
 if(!p.isSneaking||rituals.has(p.id))return;
 const bow=heldBow(p);if(!bow)return;
 if(!awakened(bow)){p.onScreenDisplay.setActionBar('§7Awaken the Spark Bow at the Spark Shrine to unlock Storm Judgment.');return;}
 if(spent(bow)){p.onScreenDisplay.setActionBar('§cSpark Bow spent - reactivate it at the Spark Shrine (10 Spark Tokens).');return;}
 const wait=readyAt(bow)-Date.now();
 if(wait>0){p.onScreenDisplay.setActionBar(`§cStorm Judgment recharging: ${Math.floor(wait/60000)}m ${Math.ceil(wait/1000)%60}s`);return;}
 system.run(()=>beginRitual(p));
});
function beginRitual(p){
 const d=p.dimension,c={...p.location};
 rituals.set(p.id,{start:system.currentTick,center:c});
 // The price: 5 hearts locked away for 30 seconds.
 safe(()=>p.setDynamicProperty('sparkmod:bow_heart_lock_until',Date.now()+HEART_LOCK_MS));
 safe(()=>{const h=p.getComponent('minecraft:health');h.setCurrentValue(Math.max(1,h.currentValue-10));});
 safe(()=>p.addEffect('fire_resistance',RITUAL_TICKS+100,{amplifier:0,showParticles:false}));
 if(d.id==='minecraft:overworld')safe(()=>d.setWeather(WeatherType.Thunder,2400));
 for(const q of safe(()=>d.getPlayers({location:c,maxDistance:64}),[])){
  F.cmd(q,'fog @s push sparkmod:eclipse sparkmod_bow_ritual');
  safe(()=>q.addEffect('darkness',80,{amplifier:0,showParticles:false}));
 }
 F.sfx(d,'sparkmod.titan.eclipse',c,4,1.2);F.sfx(d,'sparkmod.titan.charge_long',c,3,.8);
 safe(()=>p.onScreenDisplay.setTitle('§6§l⚡ STORM JUDGMENT ⚡',{subtitle:'§eRelease to fire  §c(-5 hearts for 30s)',fadeInDuration:5,stayDuration:40,fadeOutDuration:10}));
}
// Ritual circle: runes, rings, lightning striking around the archer.
system.runInterval(()=>{
 for(const [id,r] of rituals){
  const p=world.getAllPlayers().find(q=>q.id===id);
  const age=system.currentTick-r.start;
  if(!p||age>RITUAL_TICKS||!heldBow(p)){endRitual(id,p);continue;}
  const d=p.dimension,c=p.location;
  F.warn(d,c,7,6,F.C.gold);F.warn(d,c,3.5,6,F.C.white);
  F.shock(d,c,7,F.C.gold,.4);
  for(let i=0;i<8;i++){const a=i*Math.PI/4+age*.05;F.orb(d,{x:c.x+Math.cos(a)*7,y:F.groundY(d,{x:c.x+Math.cos(a)*7,y:c.y,z:c.z+Math.sin(a)*7})+.2,z:c.z+Math.sin(a)*7},.9,F.C.gold,.3,.9);}
  if(age%10<4){
   const a=Math.random()*Math.PI*2,q={x:c.x+Math.cos(a)*7,y:c.y,z:c.z+Math.sin(a)*7};
   q.y=F.groundY(d,q);
   safe(()=>d.spawnEntity('minecraft:lightning_bolt',q));
   F.bolt(d,{x:q.x,y:q.y+30,z:q.z},q,{color:F.C.white,size:.5,branches:2},4);
  }
  F.converge(d,{x:c.x,y:c.y+1.4,z:c.z},2,12,F.C.gold);
  // V246: spinning rings of light in front of the bow, throwing sparks while it charges.
  const eye=safe(()=>p.getHeadLocation(),{x:c.x,y:c.y+1.6,z:c.z}),v=safe(()=>p.getViewDirection(),{x:0,y:0,z:1});
  const grow=Math.min(1,age/40);
  for(const [dist,r] of [[1.4,.8],[2.4,1.15],[3.4,1.5]]){
   const pts=ringAround(d,{x:eye.x+v.x*dist,y:eye.y+v.y*dist-.1,z:eye.z+v.z*dist},v,r*(.5+.5*grow),12,F.C.gold,.32,age*.25*(dist%2?1:-1));
   const q=pts[Math.floor(Math.random()*pts.length)];F.sparks(d,q,3+Math.floor(grow*5),3,F.C.gold);
  }
  if(age%8===0)F.sfx(d,'sparkmod.titan.zap',eye,.8,1.4+grow*.4);
 }
},4);
function endRitual(id,p){
 rituals.delete(id);
 system.runTimeout(()=>{for(const q of world.getAllPlayers())F.cmd(q,'fog @s remove sparkmod_bow_ritual');},60);
}
// The heart price: 5 hearts can't be refilled for 30 seconds.
system.runInterval(()=>{
 for(const p of world.getAllPlayers()){
  const until=Number(safe(()=>p.getDynamicProperty('sparkmod:bow_heart_lock_until'),0)||0);
  if(!until)continue;
  if(Date.now()>=until){safe(()=>p.setDynamicProperty('sparkmod:bow_heart_lock_until',undefined));continue;}
  const h=p.getComponent('minecraft:health');if(!h)continue;
  const cap=Math.max(1,h.effectiveMax-10);
  if(h.currentValue>cap)safe(()=>h.setCurrentValue(cap));
 }
},2);
world.afterEvents.itemReleaseUse?.subscribe(({source:p,itemStack})=>{
 if(p?.typeId!=='minecraft:player'||!isSparkBow(itemStack)||!rituals.has(p.id))return;
 system.run(()=>fireJudgment(p));
});

function pickTarget(p){
 const hits=safe(()=>p.getEntitiesFromViewDirection({maxDistance:96}),[]);
 for(const h of hits){
  const e=h.entity;
  if(!e||e.id===p.id||NOT_TARGET.has(e.typeId)||!safe(()=>e.getComponent('minecraft:health'),null)||host.isAlly(p,e))continue;
  return e;
 }
 // Forgiving aim: closest enemy within a narrow cone.
 const v=p.getViewDirection(),eye=p.getHeadLocation();
 let best=null,bestScore=Infinity;
 for(const e of safe(()=>p.dimension.getEntities({location:eye,maxDistance:96}),[])){
  if(e.id===p.id||NOT_TARGET.has(e.typeId)||!safe(()=>e.getComponent('minecraft:health'),null)||host.isAlly(p,e))continue;
  const dx=e.location.x-eye.x,dy=e.location.y+1-eye.y,dz=e.location.z-eye.z,dist=Math.hypot(dx,dy,dz);
  const cos=(dx*v.x+dy*v.y+dz*v.z)/(dist||1);
  if(cos<.985)continue;
  const score=dist*(1-cos)*50+dist;
  if(score<bestScore){bestScore=score;best=e;}
 }
 return best;
}
function fireJudgment(p){
 const r=rituals.get(p.id);if(!r)return;
 endRitual(p.id,p);
 const bow=heldBow(p);
 if(bow){
  safe(()=>bow.setDynamicProperty('sparkmod:bow_spent',true));
  safe(()=>bow.setDynamicProperty('sparkmod:bow_ready_at',Date.now()+COOLDOWN_MS));
  writeHeld(p,bow);
 }
 const d=p.dimension,eye=p.getHeadLocation();
 const target=pickTarget(p);
 let impact;
 if(target)impact={...target.location};
 else{
  const hit=safe(()=>p.getBlockFromViewDirection({maxDistance:128}),null);
  const v=p.getViewDirection();
  impact=hit?{...hit.block.location}:{x:eye.x+v.x*64,y:eye.y+v.y*64,z:eye.z+v.z*64};
 }
 strike(p,d,eye,target,impact);
 safe(()=>p.onScreenDisplay.setActionBar('§6⚡ Storm Judgment fired! §7Reactivate the bow at the Spark Shrine (10 tokens) - 10 min cooldown.'));
}
// The beam, giant lightning, 10 hearts through Protection IV, freeze + Weakness III, crater.
function ringAround(d,c,u,r,n,color,size=.45,spin=0){
 // a ring of light perpendicular to direction u
 const a=Math.abs(u.y)<.9?{x:0,y:1,z:0}:{x:1,y:0,z:0};
 let v={x:u.y*a.z-u.z*a.y,y:u.z*a.x-u.x*a.z,z:u.x*a.y-u.y*a.x};const vl=Math.hypot(v.x,v.y,v.z)||1;v={x:v.x/vl,y:v.y/vl,z:v.z/vl};
 const w={x:u.y*v.z-u.z*v.y,y:u.z*v.x-u.x*v.z,z:u.x*v.y-u.y*v.x};
 const pts=[];
 for(let i=0;i<n;i++){const t=spin+i*2*Math.PI/n,q={x:c.x+(v.x*Math.cos(t)+w.x*Math.sin(t))*r,y:c.y+(v.y*Math.cos(t)+w.y*Math.sin(t))*r,z:c.z+(v.z*Math.cos(t)+w.z*Math.sin(t))*r};F.orb(d,q,size,color,.25,.9);pts.push(q);}
 return pts;
}
const BEAM_SPEED=6;   // blocks per tick: twice a full-power arrow
function strike(p,d,eye,target,impact){
 const aim={x:impact.x,y:impact.y+1,z:impact.z};
 const len=Math.hypot(aim.x-eye.x,aim.y-eye.y,aim.z-eye.z)||1,u={x:(aim.x-eye.x)/len,y:(aim.y-eye.y)/len,z:(aim.z-eye.z)/len};
 // V246: firing starts a thunderstorm.
 if(d.id==='minecraft:overworld')safe(()=>d.setWeather(WeatherType.Thunder,6000));
 F.sfx(d,'sparkmod.titan.beam',eye,6,.6);safe(()=>d.playSound('ambient.weather.thunder',eye,{volume:6,pitch:.8}));
 // V246: the beam TRAVELS (twice as fast as an arrow) wrapped in spinning rings of light.
 const travel=Math.max(1,Math.ceil(len/BEAM_SPEED));
 const drawBeam=(upto,k)=>{
  for(let s=1;s<=upto;s+=.9){const q={x:eye.x+u.x*s,y:eye.y+u.y*s,z:eye.z+u.z*s};F.orb(d,q,3.2,F.C.gold,.25,.85);F.orb(d,q,1.6,F.C.white,.25,1);}
  for(let s=3;s<=upto;s+=5)ringAround(d,{x:eye.x+u.x*s,y:eye.y+u.y*s,z:eye.z+u.z*s},u,2.4,12,(s/5)%2<1?F.C.white:F.C.gold,.5,k*.35+s*.2);
 };
 for(let t=0;t<=travel;t++)system.runTimeout(()=>{
  const upto=Math.min(len,(t+1)*BEAM_SPEED);
  drawBeam(upto,t);
  const head={x:eye.x+u.x*upto,y:eye.y+u.y*upto,z:eye.z+u.z*upto};
  F.orb(d,head,5,F.C.white,.2);F.sparks(d,head,10,6,F.C.gold);
 },t);
 for(let k=1;k<=8;k++)system.runTimeout(()=>{drawBeam(len,travel+k);F.arc(d,eye,aim,{color:F.C.white,size:.5,jag:1.2,branches:3,max:200});},travel+k*2);
 system.runTimeout(()=>impactAt(p,d,eye,target,impact,aim),travel+1);
}
function impactAt(p,d,eye,target,impact,aim){
 F.sfx(d,'sparkmod.titan.sun_explode',aim,6,1.1);
 // V247: a solid beacon-style beam of yellow light (~50x a beacon beam) crashes down from the sky onto
 // the impact and down into the crater, stays for 20 seconds, then fades away over 2 seconds.
 skyBeam(d,aim);
 F.flash(d,aim,14,F.C.white);F.flash(d,aim,8,F.C.gold);
 for(let k=0;k<4;k++)system.runTimeout(()=>{F.shock(d,impact,6+k*5,k%2?F.C.white:F.C.gold,1);F.pulse(d,aim,8+k*6,F.C.gold,.7);},k*3);
 F.debris(d,impact,4,80);F.smoke(d,aim,14,2,F.C.dust,.8);F.sparks(d,aim,90,14,F.C.gold);
 F.shake(d,aim,64,2.5,1.4);F.shake(d,eye,8,1.2,.6);
 // 10 hearts straight through Protection IV.
 if(target&&safe(()=>target.isValid,false)){
  const h=safe(()=>target.getComponent('minecraft:health'),null);
  if(h){
   if(h.currentValue>20){
    safe(()=>h.setCurrentValue(h.currentValue-20));
    safe(()=>target.applyDamage(.5,{cause:'lightning',damagingEntity:p}));
   }else safe(()=>target.applyDamage(9999,{cause:'override',damagingEntity:p}));
  }
  system.runTimeout(()=>{
   if(!safe(()=>target.isValid,false)||(safe(()=>target.getComponent('minecraft:health')?.currentValue,0)||0)<=0)return;
   // Survivors: frozen for 5 seconds, Weakness III for 10 minutes.
   if(target.typeId==='minecraft:player')safe(()=>stun(target,5));
   safe(()=>target.addEffect('slowness',100,{amplifier:255,showParticles:false}));
   safe(()=>target.addEffect('weakness',12000,{amplifier:2,showParticles:true}));
   F.cage(d,target,100,F.C.gold);
   if(target.typeId==='minecraft:player')safe(()=>target.onScreenDisplay.setTitle('§6§lJUDGED',{subtitle:'§7Frozen 5s - Weakness III for 10 minutes',fadeInDuration:2,stayDuration:60,fadeOutDuration:10}));
  },2);
 }
 megaLightning(d,impact);
 system.runTimeout(()=>blastCrater(d,impact),3);
 startScorch(d,impact,250);
}

// Beams left over from a world that was closed mid-beam are removed on load.
let beamsCleaned=false;
system.runInterval(()=>{if(beamsCleaned)return;beamsCleaned=true;
 for(const n of ['overworld','nether','the_end'])for(const e of safe(()=>world.getDimension(n).getEntities({type:'sparkmod:sky_beam'}),[]))safe(()=>e.remove());},100);
function skyBeam(d,at){
 const floor=d.id==='minecraft:overworld'?-60:d.id==='minecraft:nether'?4:0;
 const beam=safe(()=>d.spawnEntity('sparkmod:sky_beam',{x:at.x,y:floor,z:at.z}),null);
 for(let k=0;k<20;k++)system.runTimeout(()=>{       // golden rings drifting up the beam
  ringAround(d,{x:at.x,y:at.y+8+((k*7)%60),z:at.z},{x:0,y:1,z:0},12,28,F.C.gold,1.1,k*.3);
  F.sparks(d,{x:at.x+(Math.random()-.5)*16,y:at.y+1,z:at.z+(Math.random()-.5)*16},14,6,F.C.gold);
 },k*20);
 if(!beam)return;
 for(let k=0;k<=20;k++)system.runTimeout(()=>safe(()=>beam.setProperty('sparkmod:fade',Math.max(0,1-k/20))),400+k*2);
 system.runTimeout(()=>safe(()=>beam.remove()),446);
}
// ---------------------------------------------------------------- V246: scorched land (250 blocks)
// Grass turns to scorched grass, leaves burn away, logs become scorched logs, plants and bushes
// burn to dead bushes. Worked through chunk by chunk, nearest the impact first, wherever the land
// is loaded; farther land is scorched later when players go there.
const SCORCH_KEY='sparkmod:v246_scorch';
let zoneCache=null;   // loaded on first use (world data can't be read while scripts start up)
const zones=()=>zoneCache??=(safe(()=>JSON.parse(world.getDynamicProperty(SCORCH_KEY)||'[]'),[])||[]);
const saveZones=()=>safe(()=>world.setDynamicProperty(SCORCH_KEY,JSON.stringify(zones().slice(-6))));
function startScorch(d,at,r){
 zones().push({dim:d.id,x:Math.floor(at.x),z:Math.floor(at.z),r,done:[]});
 while(zones().length>6)zones().shift();
 saveZones();
}
const GROUND=new Set(['minecraft:grass_block','minecraft:grass','minecraft:podzol','minecraft:mycelium','minecraft:moss_block','sparkmod:yellow_grass','minecraft:dirt_with_roots']);
const PLANT=/short_grass|tall_grass|tallgrass|fern|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of|rose_bush|peony|lilac|sunflower|berry_bush|^minecraft:bush|petals|double_plant|red_flower|yellow_flower|torchflower|pitcher|wildflowers|dry_grass/;
function scorchColumn(d,x,z){
 const top=safe(()=>d.getTopmostBlock({x,z}),null);
 if(!top)return;
 if(safe(()=>protectedArea({x,y:top.location.y,z}),false))return;
 let y=top.location.y,bush=false;
 for(let k=0;k<48;k++,y--){
  const b=safe(()=>d.getBlock({x,y,z}));if(!b)return;
  const id=b.typeId;
  if(id==='minecraft:air'||id==='sparkmod:scorched_log')continue;
  if(/leaves|azalea|vine|snow_layer|mangrove_roots/.test(id)){safe(()=>b.setType('minecraft:air'));continue;}
  if(/_log$|_wood$|_stem$|log2|^minecraft:log/.test(id)&&!/stripped/.test(id)){safe(()=>b.setType('sparkmod:scorched_log'));continue;}
  if(PLANT.test(id)){safe(()=>b.setType('minecraft:air'));bush=bush||Math.random()<.35;continue;}
  if(GROUND.has(id)){
   safe(()=>b.setType('sparkmod:scorched_grass'));
   if(bush){const a=safe(()=>d.getBlock({x,y:y+1,z}));if(a?.isAir)safe(()=>a.setType('minecraft:deadbush'));}
  }
  return;                                         // stone, sand, water... stop here
 }
}
let scorchBusy=false;
system.runInterval(()=>{
 if(scorchBusy||!zones().length)return;
 scorchBusy=true;
 try{
  let budget=3;                                    // chunks per run
  for(const z of zones()){
   const d=safe(()=>world.getDimension(z.dim));if(!d)continue;
   const done=new Set(z.done);
   const cands=new Map();
   for(const p of safe(()=>d.getPlayers(),[])){
    const pcx=Math.floor(p.location.x/16),pcz=Math.floor(p.location.z/16);
    for(let dx=-5;dx<=5;dx++)for(let dz=-5;dz<=5;dz++){
     const cx=pcx+dx,cz=pcz+dz,k=cx+','+cz;
     if(done.has(k)||cands.has(k))continue;
     const mx=cx*16+8,mz=cz*16+8;
     const dist=Math.hypot(mx-z.x,mz-z.z);
     if(dist>z.r+12)continue;
     cands.set(k,{cx,cz,dist});
    }
   }
   const list=[...cands.values()].sort((a,b)=>a.dist-b.dist);
   for(const c of list){
    if(budget<=0)break;
    if(!safe(()=>d.getBlock({x:c.cx*16+8,y:64,z:c.cz*16+8}),null))continue;   // not loaded yet
    for(let x=0;x<16;x++)for(let zz=0;zz<16;zz++){
     const wx=c.cx*16+x,wz=c.cz*16+zz;
     if(Math.hypot(wx-z.x,wz-z.z)<=z.r)scorchColumn(d,wx,wz);
    }
    const sx=c.cx*16+8,sz=c.cz*16+8,top=safe(()=>d.getTopmostBlock({x:sx,z:sz}),null);
    if(top){F.smoke(d,{x:sx,y:top.location.y+1.5,z:sz},4,3,F.C.smoke,.8);F.sparks(d,{x:sx,y:top.location.y+1,z:sz},8,3,F.C.orange);}
    z.done.push(c.cx+','+c.cz);budget--;
   }
  }
  saveZones();
 }finally{scorchBusy=false;}
},4);

// V243: the Spark God casts the same Storm Judgment: a ritual circle of runes and lightning around
// it for `ritualTicks`, then the beam at its target from high above its head.
export function titanJudgment(titan,target,ritualTicks=50,ringRadius=12){
 const d=titan.dimension;
 const alive=()=>safe(()=>titan.isValid,false)&&(safe(()=>titan.getComponent('minecraft:health').currentValue,0)>0);
 if(d.id==='minecraft:overworld')safe(()=>d.setWeather(WeatherType.Thunder,2400));
 F.sfx(d,'sparkmod.titan.eclipse',titan.location,6,1);F.sfx(d,'sparkmod.titan.charge_long',titan.location,5,.7);
 for(const q of safe(()=>d.getPlayers({location:titan.location,maxDistance:96}),[]))
  safe(()=>q.onScreenDisplay.setTitle('§6§l⚡ STORM JUDGMENT ⚡',{subtitle:'§eThe Spark God draws its bow of light...',fadeInDuration:5,stayDuration:40,fadeOutDuration:10}));
 for(let t=0;t<ritualTicks;t+=4)system.runTimeout(()=>{
  if(!alive())return;
  const c=titan.location;
  F.warn(d,c,ringRadius,6,F.C.gold);F.warn(d,c,ringRadius/2,6,F.C.white);F.shock(d,c,ringRadius,F.C.gold,.4);
  if(t%12===0){const a=Math.random()*Math.PI*2,q={x:c.x+Math.cos(a)*ringRadius,y:c.y,z:c.z+Math.sin(a)*ringRadius};q.y=F.groundY(d,q);
   safe(()=>d.spawnEntity('minecraft:lightning_bolt',q));F.bolt(d,{x:q.x,y:q.y+30,z:q.z},q,{color:F.C.white,size:.5,branches:2},4);}
 },t);
 system.runTimeout(()=>{
  if(!alive())return;
  const s=safe(()=>titan.getComponent('minecraft:scale')?.value,1)||1;
  const eye={x:titan.location.x,y:titan.location.y+3.6*s,z:titan.location.z};
  const ok=target&&safe(()=>target.isValid,false);
  const impact=ok?{...target.location}:{...titan.location,x:titan.location.x+8};
  strike(titan,d,eye,ok?target:null,impact);
 },ritualTicks);
}
// V242: a crater 50 blocks across that goes all the way down to bedrock - straight round walls stepping in at the
// bottom; any hill/trees up to 15 blocks above it are blasted away too. Dug over a few ticks.
const CRATER_R=25,CRATER_DEPTH=40,CRATER_ABOVE=40;   // V246: clear 40 above so it is a clean round pit
function blastCrater(d,at){
 const x=Math.floor(at.x),y=Math.floor(at.y),z=Math.floor(at.z);
 const floor=d.id==='minecraft:overworld'?-59:d.id==='minecraft:nether'?5:0;
 // Never blast a protected Spark structure anywhere inside the crater.
 if(d.id==='minecraft:overworld'){
  for(let dx=-CRATER_R-2;dx<=CRATER_R+2;dx+=6)for(let dz=-CRATER_R-2;dz<=CRATER_R+2;dz+=6){
   if(dx*dx+dz*dz>(CRATER_R+2)**2)continue;
   if(safe(()=>protectedArea({x:x+dx,y,z:z+dz}),false)){F.shock(d,at,CRATER_R,F.C.white,1);return;}
  }
 }
 const fill=(x1,y1,z1,x2,y2,z2)=>safe(()=>d.runCommand(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} air`));
 const bottom=floor;                                     // V242: all the way down to bedrock level
 // [radius, from, to]: full 50-block-wide walls, then two narrowing steps at the bottom
 const layers=[[CRATER_R,Math.min(y,bottom+6),y+CRATER_ABOVE],[21,bottom+2,Math.min(y,bottom+6)-1],[15,bottom,bottom+1]];
 const jobs=[];
 for(const [r,y1,y2] of layers){
  if(y2<y1)continue;
  for(let dx=-r;dx<=r;dx++){
   const hw=Math.floor(Math.sqrt(r*r-dx*dx));
   for(let top=y2;top>=y1;top-=200)jobs.push([x+dx,Math.max(y1,top-199),z-hw,x+dx,top,z+hw]);   // keep each fill under the block limit
  }
 }
 let i=0;
 const step=()=>{for(let n=0;n<8&&i<jobs.length;n++,i++)fill(...jobs[i]);if(i<jobs.length)system.runTimeout(step,1);};
 step();
 F.debris(d,at,12,160);F.smoke(d,{x:at.x,y:at.y+2,z:at.z},30,8,F.C.dust,.85);
 for(let k=0;k<4;k++)system.runTimeout(()=>F.shock(d,at,CRATER_R+k*4,k%2?F.C.white:F.C.gold,1.2),k*3);
}
// V240: a lightning strike about 10x the size of normal lightning, crashing down on the impact.
function megaLightning(d,at){
 const sky={x:at.x,y:at.y+90,z:at.z};
 for(let k=0;k<3;k++)system.runTimeout(()=>{
  F.arc(d,sky,{x:at.x,y:at.y+.5,z:at.z},{color:F.C.white,size:3.2,jag:7,branches:6,step:.9,max:320});
  F.arc(d,{x:sky.x+(Math.random()-.5)*6,y:sky.y,z:sky.z+(Math.random()-.5)*6},{x:at.x,y:at.y+.5,z:at.z},{color:F.C.gold,size:2,jag:6,branches:4,step:1,max:220});
  F.flash(d,{x:at.x,y:at.y+3,z:at.z},26,F.C.white);
  safe(()=>d.playSound('ambient.weather.thunder',at,{volume:12,pitch:.5+k*.1}));
  safe(()=>d.playSound('ambient.weather.lightning.impact',at,{volume:8,pitch:.6}));
 },k*4);
 // a ring of real lightning around the impact
 for(let k=0;k<12;k++)system.runTimeout(()=>{
  const a=k*Math.PI/6,q={x:at.x+Math.cos(a)*4.5,y:at.y,z:at.z+Math.sin(a)*4.5};
  safe(()=>d.spawnEntity('minecraft:lightning_bolt',q));
 },1+Math.floor(k/3));
 F.sfx(d,'sparkmod.titan.explode',at,10,.6);
 F.shake(d,at,96,3.5,1.8);
}
