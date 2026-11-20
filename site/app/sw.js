// Offline support: cache the app shell; refresh network data when online.
const CACHE = "shorthop-v1";
const SHELL = ["./", "index.html", "app.css", "main.js", "fare.js", "data/network.json",
  "manifest.webmanifest", "icons/icon-192.png", "../vendor/leaflet.js", "../vendor/leaflet.css",
  "../vendor/qrcode.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks =>
  Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // map tiles, fonts: network
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
