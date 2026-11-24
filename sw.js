const CACHE='le-sales-v3';
const ASSETS=['./','index.html','owner.html','style.css','app.js','owner.js','common.js','sync.js','firebase-config.js','manifest.webmanifest','fonts/inter.woff2','fonts/sg.woff2','icons/icon-192.png','icons/icon-512.png','icons/icon-512-maskable.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const put=(r,res)=>{if(res&&res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c))}return res};
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return; const u=new URL(r.url);
  // Firebase SDK from CDN: cache-first (versioned URLs) so the app starts offline
  if(u.origin==='https://www.gstatic.com'&&u.pathname.startsWith('/firebasejs/')){e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>put(r,res))));return;}
  if(u.origin!==location.origin) return;
  // own files: network-first (always fresh when online), cache when offline
  e.respondWith(fetch(r).then(res=>put(r,res)).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('index.html'):undefined))));
});
