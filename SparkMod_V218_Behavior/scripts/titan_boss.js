import {world,system,WeatherType} from '@minecraft/server';
import * as F from './titan_fx_v217.js';
const C=F.C;

// V216/V217: make the Bolt Titan feel like a vanilla Minecraft boss (Wither / Ender Dragon style).
//  - Wither-style summoning: invulnerable while emerging, a world-wide spawn sound,
//    a title card and a knockback blast when it breaks free.
//  - Thunderstorm while the boss is alive (the "darkened sky" of the Wither, but stormy).
//  - Boss bar name changes with each phase, with an on-screen phase announcement.
//  - Slow Wither-style regeneration when nobody is fighting it, so it cannot be
//    whittled down by hit-and-run.
//  - Immune to fall damage, suffocation and drowning, like vanilla bosses.
//  - Ender Dragon-style death: beams of light, explosions and an XP fountain.
const BASE='sparkmod:bolt_titan',GIANT='sparkmod:bolt_titan_phase3',DEMON='sparkmod:spark_demon';
const TITANS=[BASE,GIANT];
const STAGE='sparkmod:boss_stage';
const LOCK='sparkmod:bolt_titan_defeated';
const safe=(fn,fallback)=>{try{return fn();}catch(e){return fallback;}};
const alive=e=>safe(()=>e?.isValid&&(e.getComponent('minecraft:health')?.currentValue??0)>0,false);
const near=(dim,at,r)=>safe(()=>dim.getPlayers({location:at,maxDistance:r}),[]);

const BAR={
 1:'§6§lBOLT TITAN',
 2:'§6§lBOLT TITAN §r§6§l[CRACKED]',
 3:'§6§lPOSSESSED BOLT TITAN',
 4:'§6§lPOSSESSED BOLT TITAN §r§6§l[OVERLOAD]'
};
function title(dim,at,main,sub,r=100){
 for(const p of near(dim,at,r))safe(()=>p.onScreenDisplay.setTitle(main,{subtitle:sub,fadeInDuration:10,stayDuration:50,fadeOutDuration:20}));
}
function soundAll(dim,id,opts){for(const p of safe(()=>dim.getPlayers(),[]))safe(()=>p.playSound(id,opts));}

// ---------- Phase tracking: boss bar name + announcements ----------
function bossStage(b){
 const h=b.getComponent('minecraft:health');if(!h)return 1;
 const f=h.currentValue/h.effectiveMax;
 if(b.typeId===GIANT)return f<.30?4:3;
 return f<=.35?2:1;
}
const ANNOUNCE={
 2:['§6§lPHASE 2','§eThe Titan cracks open... it can now teleport!'],
 3:['§6§lPHASE 3','§6The Spark Demon has possessed a new host!'],
 4:['§6§lOVERLOAD','§6The Possessed Titan is charging its final beam!']
};
function updateStage(b){
 const stage=bossStage(b);
 const old=Number(safe(()=>b.getDynamicProperty(STAGE),0)||0);
 const down=b.typeId===GIANT&&safe(()=>b.getProperty('sparkmod:shutdown'),false)===true;
 const label=down?'§6§lPOSSESSED BOLT TITAN §r§e§l[SHUT DOWN]':BAR[stage];
 if(b.nameTag!==label)safe(()=>{b.nameTag=label;});
 if(stage===old)return;
 safe(()=>b.setDynamicProperty(STAGE,stage));
 // First sighting of a phase-1/phase-3 body is announced by the emergence title instead.
 if(!old&&(stage===1||stage===3))return;
 const a=ANNOUNCE[stage];if(!a)return;
 title(b.dimension,b.location,a[0],a[1]);
 safe(()=>b.dimension.playSound('mob.wither.spawn',b.location,{volume:3,pitch:stage===4?1.3:.8}));
}

// ---------- Invulnerable while emerging (like the Wither's charge-up) ----------
world.beforeEvents.entityHurt.subscribe(ev=>{
 const b=ev.hurtEntity;
 if(!TITANS.includes(b?.typeId))return;
 const cause=ev.damageSource?.cause;
 if(cause==='fall'||cause==='suffocation'||cause==='drowning'||cause==='fallingBlock'){ev.cancel=true;return;}
 if(safe(()=>b.getProperty('sparkmod:emerging'),false)===true)ev.cancel=true;
});

// ---------- Summoning: title card, world-wide spawn sound, release blast ----------
world.afterEvents.entitySpawn.subscribe(({entity})=>{
 if(!TITANS.includes(entity.typeId))return;
 const giant=entity.typeId===GIANT;
 // Same 3-tick delay the emergence code uses, so colosseum tags are already applied.
 system.runTimeout(()=>safe(()=>{
  if(!alive(entity)||world.getDynamicProperty(LOCK)===true)return;
  if(!giant&&!entity.hasTag('sparkmod:colosseum_titan'))return;
  const dim=entity.dimension,at={...entity.location};
  updateStage(entity);
  storm();
  soundAll(dim,'mob.wither.spawn',{volume:.7,pitch:giant?.6:.8});
  title(dim,at,giant?'§6§lPOSSESSED BOLT TITAN':'§6§lBOLT TITAN',
        giant?'§6It has returned... stronger.':'§eStorm Guardian of the Colosseum',120);
  // Emergence lasts 102 ticks in bolt_titan.js; break free with a blast just after.
  system.runTimeout(()=>safe(()=>{
   if(!alive(entity))return;
   const c=entity.location;
   safe(()=>dim.spawnParticle('minecraft:huge_explosion_emitter',{x:c.x,y:c.y+1,z:c.z}));
   safe(()=>dim.playSound('random.explode',c,{volume:4,pitch:.6}));
   for(const p of near(dim,c,10)){
    const dx=p.location.x-c.x,dz=p.location.z-c.z,l=Math.hypot(dx,dz)||1;
    safe(()=>p.applyKnockback({x:dx/l*2.2,z:dz/l*2.2},.55));
   }
  }),104);
 }),3);
});

// ---------- Storm while the boss lives ----------
function storm(){safe(()=>world.getDimension('overworld').setWeather(WeatherType.Thunder,1200));}

// ---------- Main boss tick: boss bar, storm, out-of-combat regeneration ----------
const lastFought=new Map();
system.runInterval(()=>{
 let anyBoss=false;
 for(const name of ['overworld','nether','the_end']){
  const dim=safe(()=>world.getDimension(name),null);if(!dim)continue;
  for(const type of [...TITANS,DEMON])for(const b of safe(()=>dim.getEntities({type}),[])){
   if(!alive(b))continue;
   anyBoss=true;
   if(type===DEMON){
    if(b.nameTag!=='§6§lSPARK DEMON §r§e- seeking a host')safe(()=>{b.nameTag='§6§lSPARK DEMON §r§e- seeking a host';});
    continue;
   }
   updateStage(b);
   // Wither-style regen: 1% max HP per second only after 15 s with no player nearby.
   const fighting=near(dim,b.location,40).some(p=>{
    const m=safe(()=>String(p.getGameMode()).toLowerCase(),'survival');
    return m!=='creative'&&m!=='spectator';
   });
   const now=system.currentTick;
   if(fighting||!lastFought.has(b.id))lastFought.set(b.id,now);
   if(now-lastFought.get(b.id)>300)safe(()=>{
    const h=b.getComponent('minecraft:health');
    if(h&&h.currentValue<h.effectiveMax)h.setCurrentValue(Math.min(h.effectiveMax,h.currentValue+h.effectiveMax*.01));
   });
  }
 }
 if(anyBoss&&system.currentTick%600<20)storm();
 if(!anyBoss)lastFought.clear();
},20);

// ---------- Death: fuse, then the Titan EXPLODES ----------
world.afterEvents.entityDie.subscribe(({deadEntity})=>{
 const type=safe(()=>deadEntity.typeId);
 if(!TITANS.includes(type))return;
 const dim=safe(()=>deadEntity.dimension),at=safe(()=>({...deadEntity.location}));
 if(!dim||!at)return;
 if(type===BASE){
  // Not the end: the body blows apart and the Spark Demon escapes.
  safe(()=>dim.playSound('mob.wither.death',at,{volume:2,pitch:1.4}));
  title(dim,at,'§6§lTHE TITAN FALLS...','§e...but something escapes its body!');
  fuse(dim,at,30,6,C.gold);
  system.runTimeout(()=>explode(dim,at,4,C.gold),30);
  return;
 }
 deathCinematic(dim,at);
});
// Warning circle + accelerating beeps, so players can run before the blast.
function fuse(dim,at,ticks,radius,color){
 F.warn(dim,at,radius,ticks,C.red);
 let t=0;
 while(t<ticks){
  const at2=t;
  system.runTimeout(()=>{
   F.sfx(dim,'sparkmod.titan.beep',at,3,1+at2/ticks*.8);
   const c={x:at.x,y:at.y+1.5,z:at.z};
   F.orb(dim,c,1.5+at2/ticks*4,color,.15);F.converge(dim,c,4,12,color);
  },at2);
  t+=Math.max(2,Math.round(10*(1-t/ticks)));
 }
}
function explode(dim,at,power,color){
 const c={x:at.x,y:at.y+1.2,z:at.z};
 safe(()=>dim.createExplosion(c,power,{breaksBlocks:false,causesFire:false,allowUnderwater:true}));
 F.sfx(dim,'sparkmod.titan.explode',c,6+power,1.1-power*.04);
 safe(()=>dim.spawnParticle('minecraft:huge_explosion_emitter',c));
 F.flash(dim,c,power*3,color);F.flash(dim,c,power*1.5,C.white);
 for(let k=0;k<3;k++)system.runTimeout(()=>{F.shock(dim,at,power*(3+k*2),k%2?C.white:color,.9);F.pulse(dim,c,power*(2+k*1.5),color,.6);},k*3);
 F.sparks(dim,c,30+power*12,8+power,color);F.debris(dim,at,power*.8,20+power*8);
 F.smoke(dim,c,6+power*2,power*.5);
 for(let k=0;k<6;k++){const a=k*Math.PI/3;F.arc(dim,c,{x:c.x+Math.cos(a)*power*2,y:at.y,z:c.z+Math.sin(a)*power*2},{color,size:.3,branches:1,max:60});}
 F.shake(dim,c,power*12,Math.min(4,power*.45),1.2);
}
// Ender Dragon-style light show, then a huge explosion, then the XP fountain and loot.
function deathCinematic(dim,at){
 const BUILD=80,c={x:at.x,y:at.y+1.5,z:at.z};
 soundAll(dim,'mob.enderdragon.death',{volume:.8,pitch:.7});
 F.sfx(dim,'sparkmod.titan.charge_long',c,6,.5);
 fuse(dim,at,BUILD,12,C.purple);
 for(let t=0;t<BUILD;t+=2)system.runTimeout(()=>safe(()=>{
  const k=t/BUILD;
  // Rising beams of light at random angles from the body.
  for(let n=0;n<2+Math.floor(k*3);n++){
   const ang=Math.random()*Math.PI*2,tilt=.25+Math.random()*.6;
   const dx=Math.cos(ang)*tilt,dz=Math.sin(ang)*tilt;
   for(let s=0;s<16;s+=1.2)F.orb(dim,{x:at.x+dx*s,y:at.y+1.5+s,z:at.z+dz*s},.7+k*.6,n%2?C.white:C.purple,.15,.8);
  }
  if(t%8===0){
   const o={x:at.x+(Math.random()-.5)*4,y:at.y+1+Math.random()*3,z:at.z+(Math.random()-.5)*4};
   F.flash(dim,o,3,C.purple);F.sparks(dim,o,20,6,C.pink);
   F.sfx(dim,'sparkmod.titan.impact',o,2,.7+Math.random()*.5);
  }
  if(t%12===0)F.shake(dim,at,40,.3+k,.6);
 }),t);
 system.runTimeout(()=>{
  explode(dim,at,7,C.purple);
  soundAll(dim,'random.explode',{volume:.6,pitch:.5});
  safe(()=>dim.spawnParticle('minecraft:dragon_death_explosion_emitter',c));
 },BUILD);
 // XP fountain after the blast (so orbs aren't caught in it).
 for(let t=BUILD+4;t<BUILD+60;t+=2)system.runTimeout(()=>{for(let i=0;i<2;i++)safe(()=>{
  const orb=dim.spawnEntity('minecraft:xp_orb',{x:at.x,y:at.y+2,z:at.z});
  orb.applyImpulse({x:(Math.random()-.5)*.6,y:.35+Math.random()*.3,z:(Math.random()-.5)*.6});
 });},t);
 system.runTimeout(()=>safe(()=>{
  soundAll(dim,'random.levelup',{volume:1,pitch:.6});
  for(const p of near(dim,at,96))safe(()=>{
   p.addExperience(500);
   p.onScreenDisplay.setTitle('§6§lBOLT TITAN DEFEATED',{subtitle:'§eThe storm has passed.',fadeInDuration:10,stayDuration:80,fadeOutDuration:30});
  });
  world.sendMessage('§6⚡ §lThe Bolt Titan has been defeated!');
  safe(()=>world.getDimension('overworld').setWeather(WeatherType.Clear,6000));
 }),BUILD+30);
}
