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
const NOT_TARGET=new Set(['minecraft:item','minecraft:xp_orb','minecraft:lightning_bolt','minecraft:arrow']);
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
function strike(p,d,eye,target,impact){
 const aim={x:impact.x,y:impact.y+1,z:impact.z};
 // The beam: a column about 3x as thick as a beacon beam, from the bow to the target ...
 const len=Math.hypot(aim.x-eye.x,aim.y-eye.y,aim.z-eye.z),u={x:(aim.x-eye.x)/len,y:(aim.y-eye.y)/len,z:(aim.z-eye.z)/len};
 F.sfx(d,'sparkmod.titan.beam',eye,6,.6);F.sfx(d,'sparkmod.titan.sun_explode',aim,6,1.1);
 for(let k=0;k<8;k++)system.runTimeout(()=>{
  for(let s=1;s<=len;s+=.9){
   const q={x:eye.x+u.x*s,y:eye.y+u.y*s,z:eye.z+u.z*s};
   F.orb(d,q,3.2,F.C.gold,.25,.85);F.orb(d,q,1.6,F.C.white,.25,1);
  }
  F.arc(d,eye,aim,{color:F.C.white,size:.5,jag:1.2,branches:3,max:200});
 },k*2);
 // ... and a pillar of light from the sky onto the impact point.
 // V242: the sky pillar stays twice as long (2.4 s), then fades away over 1 s.
 for(let k=0;k<24;k++)system.runTimeout(()=>{for(let y=0;y<70;y+=1.5)F.orb(d,{x:aim.x,y:aim.y+y,z:aim.z},3.2,k%2?F.C.white:F.C.gold,.3,.8);},k*2);
 for(let k=0;k<10;k++)system.runTimeout(()=>{const f=1-(k+1)/11;for(let y=0;y<70;y+=1.5)F.orb(d,{x:aim.x,y:aim.y+y,z:aim.z},3.2*(.4+.6*f),F.C.gold,.3,.8*f);},48+k*2);
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
}
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
const CRATER_R=25,CRATER_DEPTH=40,CRATER_ABOVE=15;
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
