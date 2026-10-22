/* PDF Privado — service worker.
 * Solo guarda en caché los archivos de la propia aplicación (HTML, CSS, JS, librerías) para que
 * funcione sin conexión. Los documentos del usuario nunca pasan por aquí: se leen en la página. */
'use strict';

const CACHE = 'pdf-privado-v4';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/tokens.css', 'css/base.css', 'css/components.css', 'css/tools.css',
  'ui/icons.js', 'ui/boot.js', 'ui/pwa.js', 'ui/shell.js',
  'app.js', 'tools-extra.js', 'pdf-excel.js',
  'vendor/pdf-lib.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/xlsx.full.min.js',
  'vendor/jszip.min.js', 'vendor/exceljs.min.js', 'vendor/pptxgen.min.js', 'vendor/tesseract/tesseract.min.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => { /* se cacheará al usarse */ })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isVendor = url.pathname.includes('/vendor/');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    // Librerías: caché primero. Código propio: red primero (para recibir actualizaciones) y caché sin conexión.
    if (isVendor && cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
