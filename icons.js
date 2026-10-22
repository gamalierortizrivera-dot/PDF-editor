/* Iconos vectoriales (24x24, trazo). uiIcon(nombre, tamaño) devuelve un <svg>. */
'use strict';

const UI_ICON_PATHS = {
  unir: ['M5 4h8v8H5z', 'M11 12h8v8h-8z', 'M13 8h3v3'],
  dividir: ['M4 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0', 'M4 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0', 'M8 7l12 8', 'M8 17l12-8'],
  organizar: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  comprimir: ['M4 4l5 5', 'M9 4.5V9H4.5', 'M20 4l-5 5', 'M19.5 9H15V4.5', 'M4 20l5-5', 'M4.5 15H9v4.5', 'M20 20l-5-5', 'M15 19.5V15h4.5'],
  'pdf-imagenes': ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15.5 9.5h.01'],
  'imagenes-pdf': ['M6 3h8l5 5v13H6z', 'M14 3v5h5', 'M9 18l2.5-3 2 2 1.5-1.5'],
  'pdf-excel': ['M4 5h16v14H4z', 'M4 10h16', 'M4 15h16', 'M10 5v14'],
  ocr: ['M4 8V5h3', 'M17 5h3v3', 'M20 16v3h-3', 'M7 19H4v-3', 'M8 10h8', 'M8 14h5'],
  girar: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
  numerar: ['M9 4L7 20', 'M17 4l-2 16', 'M4 9h16', 'M3 15h16'],
  'marca-agua': ['M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
  recortar: ['M7 3v14h14', 'M3 7h14v14'],
  reparar: ['M4 20l9-9', 'M13 11l-2-2 4-4a3 3 0 0 1 4 4l-4 4-2-2'],
  metadatos: ['M4 4h8l8 8-8 8-8-8z', 'M8.5 8.5h.01'],
  'pdf-word': ['M6 3h8l5 5v13H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h7'],
  'pdf-powerpoint': ['M4 5h16v10H4z', 'M12 15v4', 'M8 19h8', 'M10 8.5l3.5 2-3.5 2z'],
  'excel-pdf': ['M6 3h8l5 5v13H6z', 'M14 3v5h5', 'M9 14l3 3 3-3', 'M12 17v-5'],
  proteger: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  desbloquear: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 7.5-2'],
  firmar: ['M16 3l5 5L9 20H4v-5z', 'M14 5l5 5'],
  editar: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  censurar: ['M4 6h16', 'M4 18h16', 'M4 10h16v4H4z'],
  comparar: ['M7 4v16', 'M17 4v16', 'M4 8l3-3 3 3', 'M14 16l3 3 3-3'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v4h16v-4'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  back: ['M15 5l-7 7 7 7'],
  doc: ['M6 3h8l5 5v13H6z', 'M14 3v5h5'],
};

const UI_SVG_NS = 'http://www.w3.org/2000/svg';

function uiIcon(name, size = 24, stroke = 1.8) {
  const svg = document.createElementNS(UI_SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  (UI_ICON_PATHS[name] || UI_ICON_PATHS.doc).forEach((d) => {
    const p = document.createElementNS(UI_SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  });
  return svg;
}

/** Logo: documento con escudo de seguridad. */
function uiLogo(size = 34) {
  const svg = document.createElementNS(UI_SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const el = document.createElementNS(UI_SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    svg.append(el);
  };
  add('rect', { width: '40', height: '40', rx: '11', fill: '#10B981' });
  add('path', { d: 'M12 8h10l6 6v18H12z', fill: '#04120C', opacity: '0.22' });
  add('path', { d: 'M12 8h10l6 6v18H12z', fill: 'none', stroke: '#04120C', 'stroke-width': '2.2', 'stroke-linejoin': 'round' });
  add('path', { d: 'M22 8v6h6', fill: 'none', stroke: '#04120C', 'stroke-width': '2.2', 'stroke-linejoin': 'round' });
  add('path', { d: 'M24 21l6 2.2v4.6c0 3-2.4 5-6 6.2-3.6-1.2-6-3.2-6-6.2v-4.6z', fill: '#F8FAFC', stroke: '#04120C', 'stroke-width': '1.8', 'stroke-linejoin': 'round' });
  add('path', { d: 'M21.2 27.8l2 2 3.6-3.8', fill: 'none', stroke: '#10B981', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return svg;
}
