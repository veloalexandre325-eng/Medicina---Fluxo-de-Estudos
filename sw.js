const CACHE='medicina-v30-dynamic-study';
const CORE=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));self.skipWaiting();});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('medicina-')&&k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin||url.search)return;
  const isCore=CORE.some(path=>new URL(path,self.registration.scope).pathname===url.pathname);
  if(!isCore && e.request.mode!=='navigate')return;
  e.respondWith(fetch(e.request).then(response=>{
    if(response.ok&&isCore){const copy=response.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}
    return response;
  }).catch(async()=>{
    const hit=await caches.match(e.request);if(hit)return hit;
    if(e.request.mode==='navigate')return (await caches.match('./index.html'))||Response.error();
    return Response.error();
  }));
});
