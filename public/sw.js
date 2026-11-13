/* D&E Budget service worker: shows push notifications and opens the app when one is tapped. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
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
