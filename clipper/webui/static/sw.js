// Minimal service worker — network-first, no aggressive caching so the app
// always reflects the live backend. Only registers on a secure context.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());
self.addEventListener("fetch", (e) => {
  // Never cache API or video responses; let them go straight to the network.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
