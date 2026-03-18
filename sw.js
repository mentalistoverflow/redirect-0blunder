/**
 * Service Worker — network-first with cache fallback for offline support.
 */

const CACHE_NAME = 'chess-learn-v82';

const STATIC_ASSETS = [
  '/',
  '/static/css/main.css',
  '/static/css/themes.css',
  '/static/css/tailwind-utilities.css',
  '/static/css/daisyui-components.css',
  '/static/css/style.css',
  '/static/css/responsive.css',
  '/static/vendor/chessground.base.css',
  '/static/vendor/chessground.brown.css',
  '/static/vendor/chessground.cburnett.css',
  '/static/vendor/chart.umd.min.js',
  '/static/vendor/chess-global.js',
  '/static/vendor/chessground.min.js',
  '/static/vendor/chess.min.js',
  '/static/js/app.js',
  '/static/js/live.js',
  '/static/js/eval-bar.js',
  '/static/js/websocket.js',
  '/static/js/i18n.js',
  '/static/js/csrf.js',
  '/static/js/theme.js',
  '/static/js/ai-widget.js',
  '/static/js/review.js',
  '/static/js/dashboard.js',
  '/static/js/training.js',
  '/static/js/settings.js',
  '/static/js/auth.js',
  '/static/js/admin.js',
  '/static/js/pwa.js',
  '/static/js/components/layout.js',
  '/static/js/components/sidebar.js',
  '/static/js/components/game-modal.js',
  '/static/js/components/game-end-overlay.js',
  '/static/js/friend.js',
  '/static/js/zone-drag.js',
  '/static/js/pages/pricing.js',
  '/static/locales/fr.json',
  '/static/locales/en.json',
  '/static/locales/es.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket upgrades and API POST/PUT/DELETE
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api/live/ws')) return;
  if (event.request.method !== 'GET') return;

  // Network-first for everything: try network, update cache, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
