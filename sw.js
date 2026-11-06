// Speak N Spell Service Worker - Offline Caching & PWA Support
const CACHE_NAME = 'speak-n-spell-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

// Offline starter icons (common words for instant offline availability)
const PRECACHE_ICONS = [
  'https://api.iconify.design/openmoji/cat.svg',
  'https://api.iconify.design/openmoji/dog.svg',
  'https://api.iconify.design/openmoji/apple.svg',
  'https://api.iconify.design/openmoji/banana.svg',
  'https://api.iconify.design/openmoji/elephant.svg',
  'https://api.iconify.design/openmoji/pizza.svg',
  'https://api.iconify.design/openmoji/sun.svg',
  'https://api.iconify.design/openmoji/car.svg',
  'https://api.iconify.design/openmoji/star.svg',
  'https://api.iconify.design/openmoji/butterfly.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      // Best-effort pre-caching of starter icons
      for (const url of PRECACHE_ICONS) {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) await cache.put(url, res);
        } catch (e) {
          // Ignore individual network failures during install
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // 1. Navigation requests (HTML page): Stale-While-Revalidate with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html') || caches.match('./'))
    );
    return;
  }

  // 2. Iconify & Wikimedia images: Cache-first strategy for smooth offline performance
  if (url.hostname.includes('iconify.design') || url.hostname.includes('wikimedia.org')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        }).catch(() => {
          // Return empty or fallback if offline
          return new Response('', { status: 408, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  // 3. Static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
