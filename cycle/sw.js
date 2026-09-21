const CACHE_PREFIX = "cycle-offline-";

function isAppFile(url) {
  return (
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".webmanifest")
  );
}

async function versionedCacheName() {
  try {
    const res = await fetch("./version.json", { cache: "no-store" });
    const version = await res.json();
    return CACHE_PREFIX + (version.version || "dev");
  } catch {
    return `${CACHE_PREFIX}offline`;
  }
}

async function openAppCache() {
  const keys = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX)).sort();
  if (keys.length) return caches.open(keys[keys.length - 1]);
  return caches.open(`${CACHE_PREFIX}offline`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cacheName = await versionedCacheName();
      const cache = await caches.open(cacheName);
      try {
        const res = await fetch("./version.json", { cache: "no-store" });
        const version = await res.json();
        await Promise.all(
          (version.files || []).map(async (file) => {
            try {
              await cache.add(file);
            } catch (err) {
              console.warn("Cycle SW skipped", file, err);
            }
          })
        );
      } catch (err) {
        console.warn("Cycle SW precache failed", err);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = await versionedCacheName();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== keep)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  const networkFirst = event.request.mode === "navigate" || isAppFile(url);

  event.respondWith(
    (async () => {
      if (networkFirst) {
        try {
          const fresh = await fetch(event.request);
          const cache = await openAppCache();
          cache.put(event.request, fresh.clone());
          return fresh;
        } catch (err) {
          const cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            const fallback = await caches.match("./index.html");
            if (fallback) return fallback;
          }
          throw err;
        }
      }
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const fresh = await fetch(event.request);
        const cache = await openAppCache();
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch (err) {
        if (event.request.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
