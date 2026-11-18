// SparkMod V116 — Colosseum of Prizes (builds in-game near X=1750, Z=1500).
// Inspired by the player's sandstone-and-deepslate colosseum screenshots.
import {world,system} from '@minecraft/server';
const CX=1750,CZ=1500,FLAG='sparkmod:colosseum_prizes_v116_placed';
let job=null,complete=false,lastWarning=-10000;
const AIR='minecraft:air', S='minecraft:smooth_sandstone',C='minecraft:chiseled_sandstone',B='minecraft:sandstone',K='minecraft:cobblestone',M='minecraft:mossy_cobblestone',G='minecraft:gold_block',L='minecraft:glowstone',D='minecraft:deepslate_bricks',O='minecraft:crying_obsidian';
function topY(dim){let b=dim.getTopmostBlock({x:CX,z:CZ});if(!b)return null;let y=b.location.y;for(let i=0;i<25;i++,y--){let c=dim.getBlock({x:CX,y,z:CZ});if(!c)return null;if(!/leaves|log|wood|water|grass|flower|snow|vine/.test(c.typeId))return y;}return b.location.y;}
function* plan(y){
  // Oval floor, 68 wide and 94 long, with weathered stone pattern.
  for(let z=-48;z<=48;z++)for(let x=-35;x<=35;x++){
    const q=(x*x)/(34*34)+(z*z)/(47*47);if(q>1.07)continue;
    let t=q>0.95?B:(Math.abs(x)<5&&Math.abs(z)<6?D:((x*7+z*11)%37===0?M:((x*13+z*3)%19===0?K:'minecraft:stone')));
    yield [x,y,z,t];
    // Clear above the arena so existing trees cannot obstruct it.
    for(let h=1;h<=8;h++)yield [x,y+h,z,AIR];
  }
  // Curved, tiered sandstone walls with low bleachers, like the reference.
  for(let z=-46;z<=46;z++)for(let x=-34;x<=34;x++){
    const q=(x*x)/(34*34)+(z*z)/(46*46);
    if(q<0.69||q>1.08)continue;
    const ring=q>0.95?3:q>0.86?2:1;
    const height=ring===3?9:ring===2?5:2;
    // Gate is on the north end; opening is 11 blocks wide.
    const gate=z<=-42&&Math.abs(x)<=6;
    for(let h=1;h<=height;h++){
      if(gate&&h<7)continue;
      let t=ring===3?(h%4===0?C:B):(ring===2?S:B);
      if((x*5+z*3+h*11)%53===0)t=M;
      yield [x,y+h,z,t];
    }
  }
  // Large decorative front arch and towers, facing north.
  for(const sx of [-1,1]){
    const ax=sx*10;
    for(let x=ax-3;x<=ax+3;x++)for(let z=-51;z<=-46;z++)for(let h=1;h<=15;h++){
      if(h>12&&Math.abs(x-ax)===3)continue;
      yield [x,y+h,z,(h%5===0?C:B)];
    }
    for(let x=ax-4;x<=ax+4;x++)for(let z=-52;z<=-45;z++)yield [x,y+16,z,S];
    yield [ax,y+17,-49,G];yield [ax,y+18,-49,'minecraft:fire'];
  }
  for(let x=-7;x<=7;x++)for(let h=11;h<=13;h++)yield [x,y+h,-49,(h===12?G:C)];
  // Two towering deepslate winged guardians at the entry, with purple cores.
  for(const side of [-1,1]){
    const x=side*24,z=-57;
    for(let h=1;h<=15;h++)for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
      if(Math.abs(dx)===2&&Math.abs(dz)===2)continue;
      yield [x+dx,y+h,z+dz,D];
    }
    for(let h=10;h<=16;h++)for(let a=2;a<=12;a++){
      const wx=x+side*a, wz=z+Math.floor(a/4);
      yield [wx,y+h-Math.floor(a/4),wz,D];
      if(h%3===0)yield [wx,y+h-Math.floor(a/4),wz+1,D];
    }
    for(let h=7;h<=11;h++)for(let dx=-2;dx<=2;dx++)yield [x+dx,y+h,z-3,O];
    yield [x,y+16,z,'minecraft:lightning_rod'];
    yield [x,y+17,z,'minecraft:soul_lantern'];
  }
  // Prize plinth in the center: gold/glowstone inset and four ornamental pillars.
  for(let z=-7;z<=7;z++)for(let x=-7;x<=7;x++){
    yield [x,y+1,z,Math.abs(x)===7||Math.abs(z)===7?C:S];
    if(Math.abs(x)<=3&&Math.abs(z)<=3)yield [x,y+2,z,Math.abs(x)<=1&&Math.abs(z)<=1?G:L];
  }
  for(const x of [-6,6])for(const z of [-6,6]){
    for(let h=2;h<=7;h++)yield [x,y+h,z,h===5?G:C];
    yield [x,y+8,z,L];
  }
  yield [0,y+3,0,'minecraft:chest'];
  // Red beacon beams on raised side towers, inspired by screenshots.
  for(const x of [-28,28]){
    for(let z=-27;z<=-22;z++)for(let dx=-2;dx<=2;dx++)for(let h=1;h<=13;h++){
      if(h>4&&Math.abs(dx)<2&&z>-26&&z<-23)continue;
      yield [x+dx,y+h,z,h%5===0?G:B];
    }
    for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)yield [x+dx,y+14,-25,S];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)yield [x+dx,y+15,-25,G];
    yield [x,y+16,-25,'minecraft:beacon'];
    yield [x,y+17,-25,'minecraft:red_stained_glass'];
  }
  // Entry walkway with embedded gold and glowstone.
  for(let z=-75;z<=-52;z++)for(let x=-5;x<=5;x++)yield [x,y,z,(x+z)%9===0?G:(x-z)%6===0?L:S];
}
function tick(){
  if(complete)return;
  if(!job){
    try{if(world.getDynamicProperty(FLAG)===true){complete=true;return;}}catch(e){return;}
    const dim=world.getDimension('overworld');
    if(!dim.getPlayers().some(p=>(p.location.x-CX)**2+(p.location.z-CZ)**2<95*95))return;
    let y;try{y=topY(dim);}catch(e){return;}if(!Number.isFinite(y))return;
    job={dim,iterator:plan(Math.max(-50,Math.min(285,y))),count:0};
  }
  try{
    for(let i=0;i<450;i++){
      const v=job.next || (job.next=job.iterator.next());
      if(v.done){world.setDynamicProperty(FLAG,true);complete=true;job=null;return;}
      const [dx,yy,dz,id]=v.value;
      const b=job.dim.getBlock({x:CX+dx,y:yy,z:CZ+dz});
      if(!b)return;
      b.setType(id);job.next=null;
      job.count++;
    }
  }catch(err){
    if(system.currentTick-lastWarning>6000){console.warn('[SparkMod] Colosseum generation waiting: '+String(err));lastWarning=system.currentTick;}
  }
}
system.runInterval(tick,1);


// V118: remodel the four outer colosseum pillar tops to match the supplied reference.
// Independent pass updates arenas already generated by older SparkMod versions.
const PILLAR_FLAG='sparkmod:colosseum_pillars_v118';
let pillarJob=null,pillarDone=false;
function* pillarPlan(dim,base){
  // Two monumental flared sandstone pillars on each side of the oval.
  for(const side of [-1,1])for(const z of [-26,26]){
    const x=side*37;
    // Vertical carved sandstone columns, with gold bands and weathering.
    for(let h=1;h<=22;h++)for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
      const edge=Math.abs(dx)===2||Math.abs(dz)===2;
      if(!edge && h>3)continue;
      let id=h%7===0?'minecraft:chiseled_sandstone':((dx===0&&Math.abs(dz)===2&&h>=6&&h<=18)?G:(h%4===0?S:B));
      yield [x+dx,base+h,z+dz,id];
    }
    // Layered outward-sweeping cornice; asymmetrical block steps mimic the reference.
    for(let h=19;h<=25;h++){
      const spread=h<=22?3+(h-19):h<=24?6:5;
      for(let dx=-spread;dx<=spread;dx++)for(let dz=-3;dz<=3;dz++){
        if(Math.abs(dx)===spread&&Math.abs(dz)===3)continue;
        if(h>=23&&Math.abs(dx)<2&&Math.abs(dz)<2)continue;
        const id=(h===21&&Math.abs(dx)%4===0)?G:(h%3===0?C:S);
        yield [x+dx,base+h,z+dz,id];
      }
    }
    // Vines and gilded accents along the front face.
    for(let h=5;h<=18;h++)for(const dz of [-1,1]){
      if((h+z+dz)%3!==0)yield [x-side*3,base+h,z+dz,'minecraft:vine'];
    }
    // Four separate flames at the top of each cap.
    for(const dx of [-4,-2,2,4])yield [x+dx,base+26,z,'minecraft:fire'];
  }
}
function pillarTick(){
 if(pillarDone)return;
 if(!pillarJob){
  try{if(world.getDynamicProperty(PILLAR_FLAG)===true){pillarDone=true;return;}}catch(e){return;}
  const dim=world.getDimension('overworld');
  if(!dim.getPlayers().some(p=>(p.location.x-CX)**2+(p.location.z-CZ)**2<115*115))return;
  let y;
  try{y=topY(dim);}catch(e){return;}
  if(!Number.isFinite(y))return;
  // Existing arena floor at center may be covered by prize pedestal: recover base from it.
  const already=world.getDynamicProperty(FLAG)===true;
  const base=already?y-3:y;
  pillarJob={dim,it:pillarPlan(dim,Math.max(-50,Math.min(280,base)))};
 }
 try{
  for(let i=0;i<400;i++){
   const n=pillarJob.next || (pillarJob.next=pillarJob.it.next());
   if(n.done){world.setDynamicProperty(PILLAR_FLAG,true);pillarDone=true;pillarJob=null;return;}
   const [x,y,z,id]=n.value;const b=pillarJob.dim.getBlock({x:CX+x,y,z:CZ+z});if(!b)return;b.setType(id);pillarJob.next=null;
  }
 }catch(e){/* Retry when chunks are loaded */}
}
system.runInterval(pillarTick,1);
