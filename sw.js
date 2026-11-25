const CACHE='le-sales-v4';
const ASSETS=['./','index.html','owner.html','style.css','js/core.js','js/data.js','js/ui.js','js/admin.js','firebase-config.js','manifest.webmanifest','fonts/inter.woff2','fonts/sg.woff2','icons/icon-192.png','icons/icon-512.png','icons/icon-512-maskable.png'];
const CDN=['https://www.gstatic.com/firebasejs/','https://cdn.jsdelivr.net/npm/chart.js@','https://unpkg.com/leaflet@'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const put=(r,res)=>{if(res&&(res.ok||res.type==='opaque')){const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c))}return res};
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  // versioned CDN libraries: cache-first so the app starts offline
  if(CDN.some(p=>r.url.startsWith(p))){e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>put(r,res))));return;}
  const u=new URL(r.url); if(u.origin!==location.origin) return;
  // own files: network-first (fresh when online), cache when offline
  e.respondWith(fetch(r).then(res=>put(r,res)).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('index.html'):undefined))));
});
