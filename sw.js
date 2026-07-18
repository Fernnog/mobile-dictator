const CACHE_NAME = 'power-dictator-cache-v2.0.0';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './android.html',
  './style.css',
  './js/main.js',
  './js/android.js',
  './js/app-core.js',
  './js/config.js',
  './js/llm-service.js',
  './js/hf-service.js',
  './js/speech-manager.js',
  './js/hotkeys.js',
  './js/glossary.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
