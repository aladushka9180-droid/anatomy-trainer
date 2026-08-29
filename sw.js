const CACHE='anatomy-v56';
const ASSETS=['./','./index.html','./minimal-redesign.css?v=51','./professional-learning.css?v=39','./profiles.js?v=4','./massage-data.js','./practice-cases.js','./learning-paths.js','./learning-sources.js','./reference-data.js','./massage-techniques.js?v=38','./practice-curriculum.js?v=38','./professional-learning.js?v=43','./ai-assistant.js?v=42','./manifest.webmanifest','./icon-192.png','./icon-512.png','./anatomy-upper-limb.png','./anatomy-leg.png','./anatomy-calf.png','./anatomy-gluteal.png','./anatomy-adductors.png','./anatomy-back.png','./anatomy-neck.png','./bones-skull.svg','./bones-upper-limb.svg','./bones-spine.png','./bones-vertebrae.png','./bones-lower-limb.svg','./practice-compression.png','./practice-percussion.png','./practice-passive-stretch.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('anatomy-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
  const request=e.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  e.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();e.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}
    return response;
  }).catch(()=>caches.match(request).then(cached=>cached||(request.mode==='navigate'?caches.match('./index.html'):undefined))));
});
