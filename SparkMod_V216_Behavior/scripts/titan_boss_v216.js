import {world,system,WeatherType} from '@minecraft/server';

// V216: make the Bolt Titan feel like a vanilla Minecraft boss (Wither / Ender Dragon style).
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
 2:'§6§lBOLT TITAN §r§c§l[CRACKED]',
 3:'§4§lPOSSESSED BOLT TITAN',
 4:'§4§lPOSSESSED BOLT TITAN §r§b§l[OVERLOAD]'
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
 2:['§c§lPHASE 2','§eThe Titan cracks open... it can now teleport!'],
 3:['§4§lPHASE 3','§cThe Spark Demon has possessed a new host!'],
 4:['§b§lOVERLOAD','§bThe Possessed Titan is charging its final beam!']
};
function updateStage(b){
 const stage=bossStage(b);
 const old=Number(safe(()=>b.getDynamicProperty(STAGE),0)||0);
 if(b.nameTag!==BAR[stage])safe(()=>{b.nameTag=BAR[stage];});
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
  title(dim,at,giant?'§4§lPOSSESSED BOLT TITAN':'§6§lBOLT TITAN',
        giant?'§cIt has returned... stronger.':'§eStorm Guardian of the Colosseum',120);
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
    if(b.nameTag!=='§d§lSPARK DEMON §r§7- seeking a host')safe(()=>{b.nameTag='§d§lSPARK DEMON §r§7- seeking a host';});
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

// ---------- Ender Dragon-style death ----------
world.afterEvents.entityDie.subscribe(({deadEntity})=>{
 const type=safe(()=>deadEntity.typeId);
 if(!TITANS.includes(type))return;
 const dim=safe(()=>deadEntity.dimension),at=safe(()=>({...deadEntity.location}));
 if(!dim||!at)return;
 if(type===BASE){
  // Not the end: the demon escapes. Short burst + announcement.
  safe(()=>dim.playSound('mob.wither.death',at,{volume:2,pitch:1.4}));
  title(dim,at,'§d§lTHE TITAN FALLS...','§7...but something escapes its body!');
  return;
 }
 deathCinematic(dim,at);
});
function deathCinematic(dim,at){
 const DURATION=100; // 5 seconds, like the dragon's light show.
 soundAll(dim,'mob.enderdragon.death',{volume:.8,pitch:.7});
 for(let t=0;t<DURATION;t+=2)system.runTimeout(()=>safe(()=>{
  // Rising beams of light at random angles from the body.
  for(let k=0;k<3;k++){
   const ang=Math.random()*Math.PI*2,tilt=.25+Math.random()*.6;
   const dx=Math.cos(ang)*tilt,dz=Math.sin(ang)*tilt;
   for(let s=0;s<14;s+=1.5)safe(()=>dim.spawnParticle('sparkmod:titan_overload_beam',{x:at.x+dx*s,y:at.y+1.5+s,z:at.z+dz*s}));
  }
  if(t%10===0){
   const o={x:at.x+(Math.random()-.5)*4,y:at.y+1+Math.random()*3,z:at.z+(Math.random()-.5)*4};
   safe(()=>dim.spawnParticle('minecraft:huge_explosion_emitter',o));
   safe(()=>dim.playSound('random.explode',o,{volume:2,pitch:.7+Math.random()*.4}));
  }
  // XP fountain.
  if(t%2===0)for(let i=0;i<2;i++)safe(()=>{
   const orb=dim.spawnEntity('minecraft:xp_orb',{x:at.x,y:at.y+2,z:at.z});
   orb.applyImpulse({x:(Math.random()-.5)*.6,y:.35+Math.random()*.3,z:(Math.random()-.5)*.6});
  });
 }),t);
 system.runTimeout(()=>safe(()=>{
  safe(()=>dim.spawnParticle('minecraft:huge_explosion_emitter',{x:at.x,y:at.y+1,z:at.z}));
  soundAll(dim,'random.levelup',{volume:1,pitch:.6});
  for(const p of near(dim,at,96))safe(()=>{
   p.addExperience(500);
   p.onScreenDisplay.setTitle('§6§lBOLT TITAN DEFEATED',{subtitle:'§eThe storm has passed.',fadeInDuration:10,stayDuration:80,fadeOutDuration:30});
  });
  world.sendMessage('§6⚡ §lThe Bolt Titan has been defeated!');
  safe(()=>world.getDimension('overworld').setWeather(WeatherType.Clear,6000));
 }),DURATION);
}
