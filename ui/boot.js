/* Inserta el logo y el icono de búsqueda de la cabecera (SVG). */
'use strict';
document.getElementById('logo').append(uiLogo(44));
document.getElementById('search-ico').append(uiIcon('search', 18));

/* Dentro de las apps nativas (macOS y Windows) no hace falta el enlace de descarga. */
if (/ConffettiPDF(Mac|Win)/.test(navigator.userAgent)) {
  document.getElementById('app-link').hidden = true;
  document.documentElement.dataset.native = '1';
}
