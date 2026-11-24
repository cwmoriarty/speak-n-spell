// Speak N Spell Service Worker — Clean Offline Caching & PWA Support
const STATIC_CACHE = 'speak-n-spell-static-v4';
const MEDIA_CACHE = 'speak-n-spell-media-v4';
const ACTIVE_CACHES = new Set([STATIC_CACHE, MEDIA_CACHE]);

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/mascot.js',
  './js/media.js',
  './js/speech-engine.js',
  './js/syllables.js',
  './js/vad-worklet.js',
  './js/whisper-worker.js'
];

// Synced directly with OFFLINE_STARTER_ICONS in js/media.js for genuine offline illustration rendering
const PRECACHE_ICONS = [
  'https://api.iconify.design/tabler/cat.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/dog.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/apple.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/banana.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/pizza.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/sun.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/car.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/star.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/butterfly.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/fish.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/bird.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/flower.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/tree.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/home.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/moon.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/cloud.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/book.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/cake.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/heart.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/rocket.svg?color=%231d1a16'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(STATIC_ASSETS);

      const mediaCache = await caches.open(MEDIA_CACHE);
      await Promise.allSettled(
        PRECACHE_ICONS.map(async (url) => {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) await mediaCache.put(url, res);
        })
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (!ACTIVE_CACHES.has(key) ? caches.delete(key) : Promise.resolve()))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. HTML Navigation: Network-first with proper async offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put('./index.html', response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match('./index.html')) || (await cache.match('./'));
        }
      })()
    );
    return;
  }

  // 2. Same-origin app assets (CSS, JS modules, icons): Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })()
    );
    return;
  }

  // 3. Illustration assets (Iconify & Wikimedia): Cache-first
  if (url.hostname.includes('iconify.design') || url.hostname.includes('wikimedia.org')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return new Response('', { status: 408, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
  }
});
