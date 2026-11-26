// Express Cash service worker: lets the phone app open with no signal.
// Pages: network first, falling back to the last copy. Build files: cached forever (their names change per build).
// Supabase calls are never cached; expenses made offline wait in the phone's own storage (see lib/drafts.ts).
const CACHE = "xc-v1";
const SHELL = ["/app", "/app/add", "/app/cash", "/app/install", "/icon-192.png", "/icon.png", "/xc-sm.png", "/xc.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || /\.(png|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => (res.ok && caches.open(CACHE).then((c) => c.put(req, res.clone())), res))));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => (res.ok && caches.open(CACHE).then((c) => c.put(url.pathname, res.clone())), res))
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/app"))),
    );
  }
});
