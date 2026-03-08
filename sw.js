
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  // Formato solicitado:
  // 🔔 Lembrete de Ensaio 
  // (Amanhã ou hoje)
  // ADM, Localidade, horário
  const title = '🔔 Lembrete de Ensaio';
  
  // Garante que o tempo apareça entre parênteses
  const when = data.when ? `(${data.when})` : ''; 
  const admin = data.adminName || '';
  const location = data.locationName || '';
  const time = data.time || '';
  
  const options = {
    body: `${when}\n${admin}, ${location}, ${time}`,
    icon: 'https://cdn-icons-png.flaticon.com/512/3652/3652191.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3652/3652191.png',
    data: data.locationId ? `/?locationId=${data.locationId}` : '/'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = new URL(event.notification.data, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
