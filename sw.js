const CACHE_VERSION = "enstudy-pwa-20260708-4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const STATIC_ASSETS = [
  "/",
  "/primary.html",
  "/junior.html",
  "/manifest.webmanifest",
  "/pwa.js",
  "/simple/simple.css",
  "/simple/simple-app.js",
  "/simple/data/primary_words.json",
  "/simple/data/junior_words.json",
  "/simple/data/word_images.json",
  "/simple/sounds/click.wav",
  "/simple/sounds/beep.wav",
  "/simple/sounds/correct.mp3",
  "/assets/pwa/icon.svg",
  "/assets/pwa/apple-touch-icon.png",
  "/assets/pwa/icon-192.png",
  "/assets/pwa/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("enstudy-pwa-") && !key.startsWith(CACHE_VERSION))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null))))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isFreshAppShellRequest(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/simple/images/words/")) {
    event.respondWith(cacheFirst(request));
  }
});

function isFreshAppShellRequest(request, url) {
  return request.mode === "navigate"
    || url.pathname.endsWith(".html")
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".css")
    || url.pathname.endsWith(".webmanifest");
}

function isStaticAssetRequest(request, url) {
  return url.pathname.endsWith(".json")
    || url.pathname.endsWith(".png")
    || url.pathname.endsWith(".svg")
    || url.pathname.endsWith(".mp3")
    || url.pathname.endsWith(".wav");
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("network_unavailable");
  }
}
