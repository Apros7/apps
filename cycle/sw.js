const CACHE = "cycle-offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
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
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
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

  const networkFirst =
    event.request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/sw.js");

  event.respondWith(
    (async () => {
      if (networkFirst) {
        try {
          const fresh = await fetch(event.request);
          const cache = await caches.open(CACHE);
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
        return await fetch(event.request);
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
