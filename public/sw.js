/* Imago service worker.
 *
 * Deliberately minimal: it exists to receive push notifications and to route a
 * tap back into the app. It does NOT cache or intercept fetches — the CMS is
 * always-live and a stale cached shell would be worse than a slow one.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }

  const title = data.title || "Gangrey";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/favicon-circle-192.png",
      badge: "/favicon-circle-96.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/admin/imago" },
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin/imago";

  // Prefer an already-open Imago window over spawning another one.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes("/admin/imago") && "focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
