/* Inserta el logo y el icono de búsqueda de la cabecera (SVG). */
'use strict';
document.getElementById('logo').append(uiLogo(36));
document.getElementById('search-ico').append(uiIcon('search', 18));

/* Dentro de la app nativa de macOS no hace falta el enlace de descarga. */
if (/PDFPrivadoMac/.test(navigator.userAgent)) {
  document.getElementById('app-link').hidden = true;
  document.documentElement.dataset.native = '1';
}
