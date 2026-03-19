const CACHE_NAME = 'wbw-v3';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/config.js',
  '/js/app.js',
  '/js/auth.js',
  '/js/firestore.js',
  '/js/tracker.js',
  '/js/timer.js',
  '/js/map.js',
  '/js/social.js',
  '/js/ui.js',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/audio/three.mp3',
  '/assets/audio/two.mp3',
  '/assets/audio/one.mp3',
  '/assets/audio/work.mp3',
  '/assets/audio/rest.mp3',
  '/assets/audio/getready.mp3',
  '/assets/audio/done.mp3',
  '/assets/audio/hype_home_1.mp3',
  '/assets/audio/hype_home_2.mp3',
  '/assets/audio/hype_home_3.mp3',
  '/assets/audio/hype_home_4.mp3',
  '/assets/audio/hype_home_5.mp3',
  '/assets/audio/hype_home_6.mp3',
  '/assets/audio/hype_home_7.mp3',
  '/assets/audio/hype_home_8.mp3',
  '/assets/audio/hype_done_1.mp3',
  '/assets/audio/hype_done_2.mp3',
  '/assets/audio/hype_done_3.mp3',
  '/assets/audio/hype_done_4.mp3',
  '/assets/audio/hype_done_5.mp3',
  '/assets/audio/hype_done_6.mp3',
  '/assets/audio/hype_done_7.mp3',
  '/assets/audio/hype_done_8.mp3'
];

// Install: cache static assets and skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for same-origin, fall back to cache when offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip caching for external API calls entirely
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Update cache with fresh response
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache (offline fallback)
        return caches.match(event.request);
      })
  );
});
