const CACHE='fastugi-b7-v3';
const FILES=['./','index.html','style.css','app.js','preprocess.js','inference-worker.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','model.json','models/fastugi-b7.onnx','vendor/ort.wasm.min.js','vendor/ort-wasm-simd-threaded.mjs','vendor/ort-wasm-simd-threaded.wasm'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(FILES);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('fastugi-b7-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(event.request)||fetch(event.request);})());});
