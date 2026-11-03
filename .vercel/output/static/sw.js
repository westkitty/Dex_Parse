/* DexParse service worker. Generated at build time by scripts/pwa/sw-plugin.mjs; do not edit the built copy. */
const VERSION = "67a994e66ff4";
const PRECACHE = [
  "/",
  "/__grok/icon-180.png",
  "/assets/index-CgtfAb6k.js",
  "/assets/parse-off-thread-C7Ikl4kg.js",
  "/assets/parse.worker-o212cu72.js",
  "/assets/routes-DzqBDLkA.js",
  "/assets/styles-CdZQI2Ac.css",
  "/favicon.svg",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon.svg",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/maskable.svg",
  "/manifest.webmanifest",
  "/offline.html"
];
const PREFIX = "dexparse-";
const CACHE = PREFIX + VERSION;
// Everything is relative to the worker's scope: "/" locally, "/Dex_Parse/" on GitHub Pages.
const SCOPE = new URL(self.registration.scope).pathname;
const at = (path) => SCOPE + path.replace(/^\//, "");
const SHELL = SCOPE;
const OFFLINE = at("/offline.html");
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((url) => new Request(at(url), { cache: "reload" }))),
    ),
  );
  // A first install takes control at once; an update waits for the page to say so (update banner).
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "GET_VERSION" && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function navigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]);
    const url = new URL(request.url);
    if (response.ok && url.pathname === SHELL && !url.searchParams.has("install")) cache.put(SHELL, response.clone());
    return response;
  } catch {
    return (await cache.match(SHELL)) || (await cache.match(OFFLINE)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit || Response.error());
  return hit || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(at("/api/")) || url.pathname === at("/sw.js")) return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  if (url.pathname.startsWith(at("/assets/"))) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
