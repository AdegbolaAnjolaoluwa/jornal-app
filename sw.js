/**
 * App-shell service worker: makes the app installable and lets the shell
 * (the HTML/CSS/JS shell itself, not user data) load instantly on repeat
 * visits. Deliberately does NOT cache or intercept /api/* requests - entry
 * data always needs a live network round-trip, this only covers the static
 * shell so the app *launches* fast and offline, not so it *works* offline.
 */

// The placeholder token below is substituted by scripts/build-sw.mjs at
// build time with a hash of the actual shell assets (app.html,
// manifest.json, icons) - so this changes automatically whenever any of
// them do, and nobody has to remember to bump a number by hand. This is the
// only thing that makes an already-installed PWA notice a new version
// exists: browsers re-fetch and byte-compare sw.js itself automatically,
// but that alone doesn't evict the OLD cached shell - changing CACHE_NAME
// is what makes the activate handler below actually delete it instead of
// stale-while-revalidate just adding to it and being "eventually
// consistent within a session or two."
const CACHE_NAME = "say-so-shell-25651041a89d";
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
      .then(() =>
        // Tell every open tab a new version just took over, so app.html can
        // decide when it's safe to reload (never mid-recording, never with
        // unsaved composer text) instead of yanking the page out from under
        // someone mid-task.
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
        })
      )
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
