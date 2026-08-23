/* Service worker: the only part of the app that runs while the tab is closed.
   Its single job is to turn a push into a notification. The pushes carry no payload
   (see lib/push.mjs) and the notification itself stays generic — the real figures
   (which titles, which %) only ever show up inside the app, once you open it, so
   nothing about your portfolio is readable from the notification alone. */
"use strict";

self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("Alerte portefeuille", {
    body: "Certains seuils paramétrés ont été atteints. Ouvre le tableau de bord pour voir le détail.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    lang: "fr",
    tag: "tr-alert",     // a newer alert replaces the previous one instead of stacking
    renotify: true,
    data: { url: "/?alert=1" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/?alert=1";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      await w.focus();
      w.postMessage({ type: "show-alerts" }); // already open: just raise the dialog
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// take over as soon as a new version is deployed, no reload dance required
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
