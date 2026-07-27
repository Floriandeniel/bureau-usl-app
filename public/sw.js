// Service worker Bureau'USL - gere la reception des notifications push
// et l'ouverture de l'appli quand on clique dessus.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: "Bureau'USL", body: 'Nouvelle notification' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // si jamais le contenu n'est pas du JSON valide
  }

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: '/' }
  };

  event.waitUntil(self.registration.showNotification(data.title || "Bureau'USL", options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
