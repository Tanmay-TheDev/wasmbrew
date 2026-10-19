/* WasmBrew runtime cache.
   Caches the big, versioned engine files (local jars, CheerpJ JVM and Pyodide
   CDN files) so repeat visits start fast. App code (HTML/JS) always comes
   from the network, so deploys show up immediately. */
"use strict";

const CACHE = "wasmbrew-rt-v1";
const CDN_HOSTS = new Set(["cjrtnc.leaningtech.com", "cdn.jsdelivr.net"]);

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const localBig = url.origin === self.location.origin && /\.(jar|png|wasm)$/.test(url.pathname);
  const cdn = CDN_HOSTS.has(url.host);
  if (!localBig && !cdn) return; // HTML, app JS, APIs: always plain network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    // Cache complete responses only; an errored body makes cache.put reject.
    if (res && (res.ok || res.type === "opaque")) {
      try { await cache.put(req, res.clone()); } catch (_) {}
    }
    return res;
  })());
});
