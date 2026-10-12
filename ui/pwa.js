/* Instalación como app: registra el service worker y guarda el evento de instalación. */
'use strict';

const uiPwa = {
  deferred: null,
  installed: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
  offlineReady: false,
  listeners: new Set(),
  notify() { this.listeners.forEach((fn) => fn()); },
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  uiPwa.deferred = e;
  uiPwa.notify();
});
window.addEventListener('appinstalled', () => {
  uiPwa.deferred = null;
  uiPwa.installed = true;
  uiPwa.notify();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    uiPwa.offlineReady = true;
    uiPwa.notify();
  }).catch(() => { /* sin soporte: la página sigue funcionando en línea */ });
}
