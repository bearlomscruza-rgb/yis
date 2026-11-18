import {MolangVariableMap,system} from '@minecraft/server';

// V217 visual + audio effects library for the Bolt Titan.
// Particles live in the resource pack (particles/fx_*.json), sounds in sounds/sparkmod/*.ogg.
export const C={
 cyan:{red:.35,green:.9,blue:1},
 blue:{red:.25,green:.55,blue:1},
 gold:{red:1,green:.78,blue:.2},
 orange:{red:1,green:.45,blue:.1},
 white:{red:1,green:1,blue:1},
 red:{red:1,green:.12,blue:.08},
 purple:{red:.7,green:.25,blue:1},
 pink:{red:1,green:.35,blue:.9},
 dust:{red:.45,green:.38,blue:.3},
 smoke:{red:.12,green:.12,blue:.14}
};
const safe=(fn,f)=>{try{return fn();}catch{return f;}};

function vars(o={}){
 const m=new MolangVariableMap();
 const c=o.color||C.white;
 m.setColorRGBA('variable.color',{red:c.red,green:c.green,blue:c.blue,alpha:o.alpha??1});
 m.setFloat('variable.size',o.size??1);
 m.setFloat('variable.life',o.life??.5);
 m.setFloat('variable.count',o.count??10);
 m.setFloat('variable.speed',o.speed??6);
 return m;
}
export function fx(dim,id,p,o){safe(()=>dim.spawnParticle('sparkmod:'+id,p,vars(o)));}
export function vfx(dim,id,p){safe(()=>dim.spawnParticle(id,p));}
export function sfx(dim,id,p,volume=1,pitch=1){safe(()=>dim.playSound(id,p,{volume,pitch}));}
export const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

export function groundY(dim,p){
 for(let dy=2;dy>=-8;dy--){
  const b=safe(()=>dim.getBlock({x:Math.floor(p.x),y:Math.floor(p.y)+dy,z:Math.floor(p.z)}));
  if(!b)break;
  if(!b.isAir&&!b.isLiquid)return b.location.y+1.05;
 }
 return p.y+.05;
}

// Camera shake for players near p. intensity 0..4, seconds.
export function shake(dim,p,radius,intensity,seconds){
 for(const pl of safe(()=>dim.getPlayers({location:p,maxDistance:radius}),[])){
  const d=Math.hypot(pl.location.x-p.x,pl.location.z-p.z);
  const i=Math.max(.05,intensity*(1-d/radius*.7));
  safe(()=>pl.runCommand(`camerashake add @s ${i.toFixed(2)} ${seconds} positional`));
 }
}

// Jagged lightning bolt between two points (midpoint displacement).
export function arc(dim,a,b,o={}){
 const len=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
 if(len<.1)return;
 const jag=o.jag??Math.min(1.6,len*.12);
 let pts=[a,b];
 for(let depth=0;depth<5&&pts.length<40;depth++){
  const next=[pts[0]];
  const s=jag/(depth+1);
  for(let i=1;i<pts.length;i++){
   const m=lerp(pts[i-1],pts[i],.5);
   next.push({x:m.x+(Math.random()-.5)*s*2,y:m.y+(Math.random()-.5)*s*2,z:m.z+(Math.random()-.5)*s*2},pts[i]);
  }
  pts=next;
 }
 const step=o.step??.28,size=o.size??.32,color=o.color||C.cyan;
 let budget=o.max??140;
 for(let i=1;i<pts.length&&budget>0;i++){
  const p=pts[i-1],q=pts[i];
  const l=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);
  for(let s=0;s<l&&budget>0;s+=step,budget--)fx(dim,'fx_arc',lerp(p,q,s/l),{size,color});
 }
 // Occasional forks.
 if((o.branches??1)>0)for(let k=0;k<(o.branches??1);k++){
  const from=pts[Math.floor(Math.random()*pts.length)];
  const r=len*.25;
  arc(dim,from,{x:from.x+(Math.random()-.5)*r,y:from.y-Math.random()*r*.6,z:from.z+(Math.random()-.5)*r},{...o,branches:0,size:size*.7,max:30});
 }
 fx(dim,'fx_orb',b,{size:size*4,life:.15,color});
}
// A bolt that flickers for a few ticks.
export function bolt(dim,a,b,o={},ticks=4){
 for(let t=0;t<ticks;t+=2)system.runTimeout(()=>arc(dim,typeof a==='function'?a():a,typeof b==='function'?b():b,o),t);
}
export function warn(dim,p,radius,ticks,color=C.red){
 const g={x:p.x,y:groundY(dim,p)+.02,z:p.z};
 fx(dim,'fx_warn',g,{size:radius*2,life:ticks/20,color,alpha:.85});
 fx(dim,'fx_warn',g,{size:Math.max(1,radius*.5),life:ticks/20,color,alpha:.6});
}
export function shock(dim,p,radius,color=C.cyan,life=.6){
 const g={x:p.x,y:groundY(dim,p)+.08,z:p.z};
 fx(dim,'fx_shock',g,{size:radius*2,life,color});
 system.runTimeout(()=>fx(dim,'fx_shock',{...g,y:g.y+.05},{size:radius*1.6,life:life*1.2,color:C.white,alpha:.7}),3);
}
export function pulse(dim,p,size,color=C.cyan,life=.5){fx(dim,'fx_pulse',p,{size,life,color});}
export function sparks(dim,p,count=16,speed=6,color=C.gold){fx(dim,'fx_sparks',p,{count,speed,color});}
export function debris(dim,p,radius=2,count=20){fx(dim,'fx_debris',{x:p.x,y:groundY(dim,p)+.1,z:p.z},{size:radius,count});}
export function smoke(dim,p,count=6,size=1,color=C.smoke,alpha=.85){fx(dim,'fx_smoke',p,{count,size,color,alpha});}
export function converge(dim,p,radius=3,count=14,color=C.cyan){fx(dim,'fx_converge',p,{size:radius,count,color});}
export function orb(dim,p,size=1,color=C.cyan,life=.1,alpha=1){fx(dim,'fx_orb',p,{size,life,color,alpha});}
export function motes(dim,p,size=1,count=4,color=C.cyan){fx(dim,'fx_mote',p,{size,count,color});}
export function flash(dim,p,size=6,color=C.white){orb(dim,p,size,color,.25);orb(dim,p,size*.45,C.white,.35);}

// Animated electric cage around an entity (stuns, possession).
export function cage(dim,e,ticks,color=C.cyan,radius=.9){
 for(let t=0;t<ticks;t+=4)system.runTimeout(()=>safe(()=>{
  if(!e.isValid)return;
  const l=e.location;
  const ang=Math.random()*Math.PI*2;
  for(let k=0;k<3;k++){
   const a=ang+k*2.094;
   const x=l.x+Math.cos(a)*radius,z=l.z+Math.sin(a)*radius;
   arc(dim,{x,y:l.y+.05,z},{x:l.x+Math.cos(a+1)*radius,y:l.y+2,z:l.z+Math.sin(a+1)*radius},{color,size:.18,jag:.25,branches:0,max:24});
  }
  motes(dim,{x:l.x,y:l.y+1,z:l.z},.5,3,color);
 }),t);
}
// Chest-height position of the titan (scales with size).
export function core(b){
 const s=safe(()=>b.getComponent('minecraft:scale')?.value,1)||1;
 const big=b.typeId==='sparkmod:bolt_titan_phase3';
 return {x:b.location.x,y:b.location.y+(big?2.6:2.3)*s,z:b.location.z};
}
