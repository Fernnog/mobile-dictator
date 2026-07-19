const CACHE_NAV = 'dd-nav-v2.0.1';
const CACHE_STATIC = 'dd-static-v2.0.1';

// Assets de navegação/lógica: sempre buscar rede primeiro para atualização imediata
const NAVIGATION_ASSETS = [
  './',
  './index.html',
  './android.html',
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

// Assets imutáveis: CSS, ícones, favicon. Nomes só mudam quando o SW muda.
const STATIC_ASSETS = [
  './style.css',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/favicon.ico'
];

/* ---------- INSTALAÇÃO ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAV).then((c) => c.addAll(NAVIGATION_ASSETS)),
      caches.open(CACHE_STATIC).then((c) => c.addAll(STATIC_ASSETS))
    ])
  );
  // Ativa imediatamente, sem esperar o fechamento de abas
  self.skipWaiting();
});

/* ---------- ATIVAÇÃO ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          // Limpa apenas caches de versões anteriores deste app
          if (key !== CACHE_NAV && key !== CACHE_STATIC) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ESTRATÉGIA 1: Cache-First para assets estáticos imutáveis
  const isStaticAsset =
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.endsWith('.css') ||
    url.pathname.startsWith('/assets/');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ESTRATÉGIA 2: Network-First para navegação e JS
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAV).then((c) => c.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
