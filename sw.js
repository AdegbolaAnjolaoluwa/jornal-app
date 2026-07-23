/**
 * App-shell service worker: makes the app installable and lets the shell
 * (the HTML/CSS/JS shell itself, not user data) load instantly on repeat
 * visits. Deliberately does NOT cache or intercept /api/* requests - entry
 * data always needs a live network round-trip, this only covers the static
 * shell so the app *launches* fast and offline, not so it *works* offline.
 */

const CACHE_NAME = "say-so-shell-v1";
const SHELL_ASSETS = ["/app", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API calls or cross-origin requests (fonts CDN, etc.) - only
  // the app shell itself is cached here.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
