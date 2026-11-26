// Importado pelo Service Worker gerado pelo vite-plugin-pwa (workbox.importScripts).
// Trata o recebimento de Web Push (app fechado) e o clique nas notificações de ensaio e reuniões.

// Monta a URL relativa ao escopo do app (funciona em subpastas do GitHub Pages)
const buildAppUrl = (data) => {
  const url = new URL('./', self.registration.scope);
  if (data && data.locationId) {
    url.searchParams.set('locationId', data.locationId);
  } else if (data && data.section) {
    url.searchParams.set('section', data.section);
  }
  return url.href;
};

const parsePushPayload = (event) => {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
};

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  const icon = new URL('./icons/icon-192.png', self.registration.scope).href;

  // Aceita tanto um lote ({ notifications: [...] }) quanto uma única notificação
  const items = Array.isArray(payload.notifications) ? payload.notifications : [payload];

  const promises = items.map((item) => {
    const title = item.title || 'Lembrete de Ensaio';
    const when = item.when ? `(${item.when})` : '';
    const fallbackParts = [item.adminName, item.locationName, item.time].filter(Boolean).join(', ');
    const body = item.body || [when, fallbackParts].filter(Boolean).join('\n');

    const options = {
      body,
      icon,
      badge: icon,
      data: {
        locationId: item.locationId || null,
        section: item.section || null,
      },
    };
    if (item.tag) {
      options.tag = item.tag;
    }

    return self.registration.showNotification(title, options);
  });

  event.waitUntil(Promise.all(promises));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = buildAppUrl(event.notification.data);

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
