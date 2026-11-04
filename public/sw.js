// Sayso's service worker: shows the owner's notifications, opens the right screen when one is tapped,
// and hands photos shared to the installed app (Android's share sheet) to the "add from a photo" page.
// It caches no pages: every screen is live shop state, and a stale approval screen is worse than none.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/owner/share') return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const photos = form.getAll('photos').filter((f) => f instanceof File && f.type.startsWith('image/')).slice(0, 6);
      const cache = await caches.open('sayso-share');
      await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
      await Promise.all(photos.map((f, i) => cache.put(`/owner/share/photo-${i}`, new Response(f, { headers: { 'Content-Type': f.type } }))));
      return Response.redirect(`/owner/catalog/new?shared=${photos.length}`, 303);
    })(),
  );
});

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { title: 'Sayso', body: event.data ? event.data.text() : '' };
  }
  const title = message.title || 'Sayso';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: message.body || '',
      tag: message.tag || undefined,
      renotify: Boolean(message.tag),
      requireInteraction: /\?$/.test(title), // a request waiting for a decision stays until it is seen
      icon: '/app-icon/192',
      badge: '/app-icon/192',
      data: { url: message.url || '/owner' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/owner', self.location.origin);
  if (target.origin !== self.location.origin) return; // only ever open Sayso itself
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === target.origin);
      if (open) {
        await open.focus();
        return open.navigate(target.href);
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
