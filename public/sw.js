/* D&E Budget service worker: caches the app's own files so repeat opens don't wait on the network, and shows push
   notifications. Hashed build files (/assets/…) are cache-first — their names change on every deploy; the page
   itself is network-first so a new deploy shows on the next open, with the cached copy as the offline fallback.
   The API is never cached here (the app keeps its own per-screen copies). */
const CACHE = "de-budget-static-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(Promise.all([self.clients.claim(), caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))])));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const hashed = url.pathname.startsWith("/assets/");
  const icon = /\.(png|ico|svg|webmanifest)$/.test(url.pathname);
  if (hashed || icon) {
    e.respondWith(caches.open(CACHE).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }));
    return;
  }
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      try { const res = await fetch(req); if (res.ok) c.put("/index.html", res.clone()); return res; }
      catch { return (await c.match("/index.html")) || Response.error(); }
    }));
  }
});
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "D&E Budget", body: e.data ? e.data.text() : "" }; }
  const title = data.title || "D&E Budget";
  e.waitUntil(self.registration.showNotification(title, { body: data.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: data.tag || "de-budget", renotify: !!data.tag, data: { url: data.url || "/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if ("focus" in w) { w.navigate(url); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
