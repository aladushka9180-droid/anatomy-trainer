const CACHE='anatomy-v76';
const MOTION_IDS=['abduction','elbow','hip','knee','foot','head'];
const MOTION_PRIMARY=MOTION_IDS.flatMap(id=>[`./anatomy-motion-v8/${id}.mp4?v=blender-v1`,`./anatomy-motion-v8/${id}.webp?v=blender-v1`]);
const MOTION_LEGACY=MOTION_IDS.flatMap(id=>[`./anatomy-motion-v6/${id}.mp4?v=2`,`./anatomy-motion-v5/${id}/frame-${id==='abduction'?'07':'08'}.webp`]);
const ASSETS=['./','./index.html','./minimal-redesign.css?v=57','./professional-learning.css?v=43','./anatomy-learning.css?v=12','./profiles.js?v=4','./massage-data.js','./practice-cases.js','./learning-paths.js','./learning-sources.js','./reference-data.js?v=2','./massage-techniques.js?v=38','./practice-curriculum.js?v=38','./professional-learning.js?v=47','./ai-assistant.js?v=44','./anatomy-learning.js?v=14','./manifest.webmanifest','./icon-192.png','./icon-512.png','./anatomy-upper-limb.png','./anatomy-leg.png','./anatomy-calf.png','./anatomy-gluteal.png','./anatomy-adductors.png','./anatomy-back.png','./anatomy-neck.png','./bones-skull.svg','./bones-upper-limb.svg?v=2','./bones-spine.png','./bones-vertebrae.png','./bones-lower-limb.svg?v=2','./practice-compression.png','./practice-percussion.png','./practice-passive-stretch.png',...MOTION_LEGACY];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(async cache=>{
  await cache.addAll(ASSETS);
  await Promise.all(MOTION_PRIMARY.map(asset=>cache.add(asset).catch(()=>undefined)));
}).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('anatomy-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));

function parseRange(header,size){
  const match=/^bytes=(\d*)-(\d*)$/.exec((header||'').trim());
  if(!match||(!match[1]&&!match[2]))return null;
  let start,end;
  if(match[1]){
    start=Number(match[1]);
    end=match[2]?Number(match[2]):size-1;
  }else{
    const suffix=Number(match[2]);
    if(!Number.isSafeInteger(suffix)||suffix<=0)return null;
    start=Math.max(0,size-suffix);
    end=size-1;
  }
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=size)return null;
  return {start,end:Math.min(end,size-1)};
}

async function cachedRangeResponse(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request.url,{ignoreVary:true});
  if(!cached||cached.status!==200)return null;
  const buffer=await cached.arrayBuffer();
  const range=parseRange(request.headers.get('range'),buffer.byteLength);
  if(!range)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${buffer.byteLength}`,'Accept-Ranges':'bytes'}});
  const headers=new Headers(cached.headers);
  headers.delete('content-encoding');
  headers.set('Accept-Ranges','bytes');
  headers.set('Content-Range',`bytes ${range.start}-${range.end}/${buffer.byteLength}`);
  headers.set('Content-Length',String(range.end-range.start+1));
  if(!headers.has('Content-Type'))headers.set('Content-Type','video/mp4');
  return new Response(buffer.slice(range.start,range.end+1),{status:206,statusText:'Partial Content',headers});
}

self.addEventListener('fetch',e=>{
  const request=e.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.headers.has('range')&&url.pathname.toLowerCase().endsWith('.mp4')){
    e.respondWith(cachedRangeResponse(request).then(response=>response||fetch(request)));
    return;
  }
  e.respondWith(fetch(request).then(response=>{
    if(response.ok&&response.status===200){const copy=response.clone();e.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||(request.mode==='navigate'?caches.match('./index.html'):undefined))));
});
