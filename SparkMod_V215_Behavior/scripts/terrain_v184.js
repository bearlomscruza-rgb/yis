// Shared terrain lookup. Always invoked after world start, never at import time.
// Prefer Dimension.getTopmostBlock where supported; scan downward as a fallback.
export function terrainTop(dim, x, z) {
  if (typeof x === 'object' && x !== null) { z = x.z; x = x.x; }
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  x=Math.floor(x); z=Math.floor(z);
  try {
    if (typeof dim.getTopmostBlock === 'function') {
      const block=dim.getTopmostBlock({x,y:64,z});
      if (block) {
        if (!/leaves|log|wood|vine|flower|grass|snow_layer|bamboo|kelp|seagrass|cobweb/.test(block.typeId)) return block;
        for(let y=block.location.y-1;y>=Math.max(-64,block.location.y-30);y--){
          const below=dim.getBlock({x,y,z});
          if(!below)return undefined;
          if(!below.isAir&&!below.isLiquid&&!/leaves|log|wood|vine|flower|grass|snow_layer|bamboo|kelp|seagrass|cobweb/.test(below.typeId))return below;
        }
      }
    }
  }catch(error){/* Older Bedrock script API: fall back to scanning. */}
  for(let y=319;y>=-64;y--){
    let block;
    try{block=dim.getBlock({x,y,z});}catch{return undefined;}
    if(!block)return undefined; // Not loaded: try again when closer.
    if(block.isAir||block.isLiquid)continue;
    if(/leaves|log|wood|vine|flower|grass|snow_layer|bamboo|kelp|seagrass|cobweb/.test(block.typeId))continue;
    return block;
  }
  return undefined;
}
