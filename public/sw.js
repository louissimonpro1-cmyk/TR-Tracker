/* Service worker: the only part of the app that runs while the tab is closed.
   Its single job is to turn a push into a notification. The pushes carry no payload
   (see lib/push.mjs), so the real content is fetched here from /api/alerts with the
   session cookie — that keeps the portfolio figures off the push provider's servers. */
"use strict";

const FALLBACK_TITLE = "Alerte portefeuille";
const FALLBACK_BODY = "Ouvre le tableau de bord pour voir les positions concernées.";

const pctFr = (v) =>
  (v > 0 ? "+" : "") + v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";

async function buildNotification() {
  try {
    const r = await fetch("/api/alerts", { credentials: "include", cache: "no-store" });
    if (!r.ok) return null;
    const { triggers } = await r.json();
    if (!triggers?.length) return null;
    const lines = triggers.slice(0, 4).map((t) => `${t.name} · ${pctFr(t.actualPct)} ${t.label}`);
    if (triggers.length > lines.length) lines.push(`+ ${triggers.length - lines.length} autre(s)`);
    return {
      title: triggers.length === 1 ? triggers[0].name : `${triggers.length} alertes sur ton portefeuille`,
      body: lines.join("\n"),
    };
  } catch {
    return null; // offline, or the session expired: the generic notification still shows
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const n = await buildNotification();
    // a push event MUST end in a visible notification, otherwise the browser shows its
    // own "this site was updated in the background" message and may revoke permission
    await self.registration.showNotification(n?.title || FALLBACK_TITLE, {
      body: n?.body || FALLBACK_BODY,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      lang: "fr",
      tag: "tr-alert",     // a newer alert replaces the previous one instead of stacking
      renotify: true,
      data: { url: "/?alert=1" },
    });
  })());
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
