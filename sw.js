// Speak N Spell Service Worker — Clean Offline Caching & Bounded Media Cache
const STATIC_CACHE = 'speak-n-spell-static-v5';
const MEDIA_CACHE = 'speak-n-spell-media-v5';
const ACTIVE_CACHES = new Set([STATIC_CACHE, MEDIA_CACHE]);
const MAX_MEDIA_ENTRIES = 160;

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

// Synced directly with PICTURE_CATALOG & OFFLINE_STARTER_ICONS in js/media.js
const PRECACHE_ICONS = [
  'https://api.iconify.design/lucide/apple.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/banana.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/cherry.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/grape.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/citrus.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/melon.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/cat.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/dog.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/butterfly.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/bird.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/fish.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/turtle.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/rabbit.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/squirrel.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/sun.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/moon.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/star.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/rainbow.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/flower-2.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/tree-pine.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/cloud.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/rocket.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/house.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/car.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/bike.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/plane.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/pizza.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/cake.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/book-open.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/umbrella.svg?color=%231d1a16',
  'https://api.iconify.design/tabler/lemon.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/carrot.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/cookie.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/ice-cream-cone.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/snail.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/heart.svg?color=%231d1a16',
  'https://api.iconify.design/lucide/crown.svg?color=%231d1a16'
];

async function trimMediaCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_MEDIA_ENTRIES) return;
  const excess = keys.length - MAX_MEDIA_ENTRIES;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

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

  // 1. HTML Navigation: Network-first with async offline fallback
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

  // 2. Same-origin app assets: Stale-While-Revalidate
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

  // 3. Illustration assets (Iconify & Wikimedia): Cache-first with bounded size
  if (url.hostname.includes('iconify.design') || url.hostname.includes('wikimedia.org')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            await cache.put(request, res.clone());
            trimMediaCache(cache);
          }
          return res;
        } catch {
          return new Response('', { status: 408, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
  }
});
