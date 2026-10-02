/* Forus Tempo: caché para que la app abra sin conexión. */
const CACHE = 'forus-tempo-v4';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './favicon.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Páginas: primero la red (así llegan las actualizaciones), y si no hay conexión, la copia guardada.
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).then(r => store('./index.html', r)).catch(() => caches.match('./index.html')));
      return;
    }
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => store(req, r))));
    return;
  }

  // Fuentes de Google: se guardan la primera vez para usarlas sin conexión.
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => store(req, r)).catch(() => m)));
  }
});

// Avisos: los envía el servidor de avisos (carpeta push/) y aquí se muestran.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || 'Forus Tempo', {
    body: d.body || '', tag: d.tag || 'forus-tempo', icon: 'icon-192.png', badge: 'icon-192.png', lang: 'es'
  })];
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
    jobs.push((d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  e.waitUntil(Promise.all(jobs));
});

// Al tocar el aviso: abre la app (o la trae al frente si ya está abierta).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const scope = self.registration.scope;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(scope) && 'focus' in c) return c.focus();
    return clients.openWindow(scope);
  }));
});
