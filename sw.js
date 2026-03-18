const CACHE_NAME = 'rbr-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/config.js',
  '/js/app.js',
  '/js/auth.js',
  '/js/firestore.js',
  '/js/tracker.js',
  '/js/map.js',
  '/js/social.js',
  '/js/ui.js',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

// Install: cache static assets and skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches and claim clients
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

// Fetch: cache-first for same-origin, skip external API calls
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip caching for Firebase, Mapbox, and Google API calls
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('api.mapbox.com') ||
    url.hostname.includes('tiles.mapbox.com') ||
    url.hostname.includes('events.mapbox.com') ||
    url.hostname.includes('googleapis.com')
  ) {
    return;
  }

  // Only handle same-origin requests with cache-first strategy
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => {
          if (cached) {
            return cached;
          }
          return fetch(event.request).then((response) => {
            // Only cache successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return response;
          });
        })
    );
  }
});
