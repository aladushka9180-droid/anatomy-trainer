const CACHE='anatomy-v12';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./anatomy-upper-limb.png','./anatomy-leg.png','./anatomy-gluteal.png','./anatomy-adductors.png','./anatomy-back.png','./anatomy-neck.png','./bones-skull.svg','./bones-upper-limb.svg','./bones-spine.png','./bones-vertebrae.png','./bones-lower-limb.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html')))));
