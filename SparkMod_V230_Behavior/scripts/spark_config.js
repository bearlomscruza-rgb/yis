import {world} from '@minecraft/server';

// V229: world settings, changed in game with /deck3 (operators only).
const KEY='sparkmod:config';
export const DEFAULTS=Object.freeze({
 clearLocatorMaps:true,   // instantly clear locator maps everywhere
 clearBundles:true,       // instantly clear bundles everywhere
 maceLimit:3,             // how many ordinary maces may exist in the world
 sparkMaceLimit:1         // how many survival Spark Maces may exist in the world
});
let cache=null,cacheAt=-1;
export function getConfig(){
 // Cheap enough to read often; refreshed at most once per tick-ish.
 const now=Date.now();
 if(cache&&now-cacheAt<250)return cache;
 let stored={};
 try{stored=JSON.parse(world.getDynamicProperty(KEY)||'{}')||{};}catch{stored={};}
 cache={...DEFAULTS,...stored};cacheAt=now;
 return cache;
}
export function setConfig(patch){
 const next={...getConfig(),...patch};
 try{world.setDynamicProperty(KEY,JSON.stringify(next));}catch{}
 cache=next;cacheAt=Date.now();
 return next;
}
