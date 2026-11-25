// Importado pelo Service Worker gerado pelo vite-plugin-pwa (workbox.importScripts).
// Trata o clique nas notificações de ensaio, abrindo o app na localidade correspondente.

// Monta a URL relativa ao escopo do app (funciona em subpastas do GitHub Pages)
const buildAppUrl = (locationId) => {
  const url = new URL('./', self.registration.scope);
  if (locationId) url.searchParams.set('locationId', locationId);
  return url.href;
};

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  // Formato:
  // 🔔 Lembrete de Ensaio
  // (Amanhã ou hoje)
  // ADM, Localidade, horário
  const title = '🔔 Lembrete de Ensaio';
  const when = data.when ? `(${data.when})` : '';
  const admin = data.adminName || '';
  const location = data.locationName || '';
  const time = data.time || '';
  const icon = new URL('./icons/icon-192.png', self.registration.scope).href;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: `${when}\n${admin}, ${location}, ${time}`,
      icon,
      badge: icon,
      data: { locationId: data.locationId || null },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const locationId = event.notification.data && event.notification.data.locationId;
  const urlToOpen = buildAppUrl(locationId);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se o app já estiver aberto, reaproveita a janela
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'navigate' in client) {
          return client.navigate(urlToOpen).then((c) => (c ? c.focus() : undefined));
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
