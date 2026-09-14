/**
 * service-worker.js
 * Cache básico "app shell" para permitir instalar o Radar de
 * Oportunidades como PWA e abrir offline. Os dados continuam sendo
 * lidos/gravados via localStorage no próprio navegador — este worker
 * só cuida dos arquivos estáticos do app.
 */

const CACHE_NAME = 'radar-oportunidades-v6';
const ARQUIVOS_APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './js/storage.js',
  './js/parser.js',
  './js/ocr.js',
  './js/cards.js',
  './js/alerts.js',
  './js/strategies.js',
  './js/stats.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_APP_SHELL)).catch((err) => {
      console.warn('[service-worker] Falha ao pré-cachear alguns arquivos:', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(
        chaves.filter((chave) => chave !== CACHE_NAME).map((chave) => caches.delete(chave))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.indexOf(self.location.origin) !== 0) return;

  // Para HTML e JavaScript, prioriza a rede. Isso evita que uma versão antiga
  // do PWA fique presa no cache depois de uma atualização no GitHub Pages.
  const url = new URL(event.request.url);
  const caminho = url.pathname.toLowerCase();
  const ehCodigoOuHtml =
    caminho.endsWith('.html') ||
    caminho.endsWith('.js') ||
    caminho.endsWith('/');

  if (ehCodigoOuHtml) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((resposta) => {
          if (resposta && resposta.ok && event.request.method === 'GET') {
            const copia = resposta.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          }
          return resposta;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Imagens/CSS e demais arquivos: cache primeiro, com fallback de rede.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resposta) => {
          if (resposta && resposta.status === 200 && event.request.method === 'GET') {
            const copia = resposta.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          }
          return resposta;
        })
        .catch(() => cached);
    })
  );
});
