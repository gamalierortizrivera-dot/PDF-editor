/* PDF Privado — shell de interfaz: catálogo, búsqueda, pestañas y espacio de trabajo en pasos.
 * Las herramientas (app.js, tools-extra.js, pdf-excel.js) solo se registran en `tools` y
 * se montan con render(box); este archivo decide cómo se presentan. */
'use strict';

const UI_CATS = [
  { id: 'all', label: 'Todas' },
  { id: 'org', label: 'Organizar y Editar', tag: 'Organizar y Editar' },
  { id: 'from', label: 'Convertir desde PDF', tag: 'Desde PDF' },
  { id: 'to', label: 'Convertir a PDF', tag: 'A PDF' },
  { id: 'sec', label: 'Seguridad y Ajustes', tag: 'Seguridad y Ajustes' },
];

/* Orden = el de la especificación. short: descripción de una línea; kw: palabras clave de búsqueda. */
const TOOL_UI = {
  unir: { cat: 'org', short: 'Combina varios PDF en uno solo.', kw: 'combinar juntar fusionar merge' },
  dividir: { cat: 'org', short: 'Separa o extrae páginas del documento.', kw: 'separar extraer partir split' },
  organizar: { cat: 'org', short: 'Reordena, gira y elimina páginas.', kw: 'ordenar reordenar mover arrastrar' },
  comprimir: { cat: 'sec', short: 'Reduce el peso del archivo.', kw: 'reducir tamaño peso optimizar' },
  'pdf-imagenes': { cat: 'from', short: 'Cada página como imagen JPG o PNG.', kw: 'jpg png foto imagen exportar' },
  'imagenes-pdf': { cat: 'to', short: 'Junta fotos y escaneos en un PDF.', kw: 'jpg png foto imagen escaner' },
  'pdf-excel': { cat: 'from', short: 'Extrae tablas a una hoja de Excel.', kw: 'xlsx tabla hoja calculo exel' },
  ocr: { cat: 'sec', short: 'Haz buscable el texto de un escaneo.', kw: 'escaneado texto reconocer buscable ocr' },
  girar: { cat: 'org', short: 'Gira todas las páginas o algunas.', kw: 'rotar orientacion' },
  numerar: { cat: 'sec', short: 'Añade el número en cada página.', kw: 'numeracion paginas foliar' },
  'marca-agua': { cat: 'sec', short: 'Estampa un texto sobre cada página.', kw: 'watermark sello confidencial borrador' },
  recortar: { cat: 'org', short: 'Quita márgenes de las páginas.', kw: 'crop margenes cortar' },
  reparar: { cat: 'org', short: 'Reconstruye un PDF dañado.', kw: 'arreglar danado corrupto no abre' },
  metadatos: { cat: 'sec', short: 'Ver, editar o borrar datos ocultos.', kw: 'autor titulo privacidad propiedades' },
  'pdf-word': { cat: 'from', short: 'Extrae el texto a un .docx editable.', kw: 'docx documento word texto' },
  'pdf-powerpoint': { cat: 'from', short: 'Cada página, una diapositiva.', kw: 'pptx diapositivas presentacion slides' },
  'excel-pdf': { cat: 'to', short: 'Convierte hojas de cálculo a PDF.', kw: 'xlsx xls csv hoja calculo exel' },
  proteger: { cat: 'sec', short: 'Pide contraseña para abrirlo.', kw: 'contrasena cifrar clave encriptar password' },
  desbloquear: { cat: 'sec', short: 'Quita la contraseña del PDF.', kw: 'quitar contrasena restricciones abrir' },
  firmar: { cat: 'sec', short: 'Dibuja o escribe tu firma.', kw: 'firma sign rubrica' },
  editar: { cat: 'sec', short: 'Añade texto, imágenes y resaltados.', kw: 'texto imagen resaltar tapar anotar' },
  censurar: { cat: 'sec', short: 'Oculta datos sensibles de verdad.', kw: 'redactar tachar ocultar privacidad' },
  qr: { cat: 'org', short: 'Crea un QR y ponlo en un PDF.', kw: 'qr codigo barras wifi vcard enlace url contacto escanear' },
  comparar: { cat: 'sec', short: 'Muestra qué cambió entre versiones.', kw: 'diferencias diff versiones cambios' },
};
const TOOL_ORDER = Object.keys(TOOL_UI);
const catById = (id) => UI_CATS.find((c) => c.id === id);

const uiState = { cat: 'all', q: '' };
let uiObserver = null;
const searchInput = document.getElementById('search');

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function uiTools() {
  return TOOL_ORDER.map((id) => tools.find((t) => t.id === id)).filter(Boolean);
}

function matchesQuery(t, q) {
  const hay = norm([t.title, TOOL_UI[t.id].short, TOOL_UI[t.id].kw].join(' '));
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function stopObserver() {
  if (uiObserver) { uiObserver.disconnect(); uiObserver = null; }
}

/* ---------- Catálogo ---------- */

function toolCard(t) {
  const meta = TOOL_UI[t.id];
  const cat = catById(meta.cat);
  return h('button', { class: 'card c-' + meta.cat, onclick: () => { location.hash = t.id; } },
    h('span', { class: 'tile' }, uiIcon(t.id, 26)),
    h('h3', {}, t.title.replace(/^OCR: .*/, 'OCR (PDF escaneado)')),
    h('p', {}, meta.short),
    h('span', { class: 'tag' }, cat.tag));
}

function renderHome() {
  stopObserver();
  document.title = 'PDF Privado — herramientas PDF 100% locales';
  const all = uiTools();
  const q = norm(uiState.q.trim());
  const list = all.filter((t) => (q ? matchesQuery(t, q) : uiState.cat === 'all' || TOOL_UI[t.id].cat === uiState.cat));
  const count = (id) => all.filter((t) => id === 'all' || TOOL_UI[t.id].cat === id).length;

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Categorías de herramientas' },
    ...UI_CATS.map((c) => {
      const active = !q && uiState.cat === c.id;
      return h('button', {
        class: 'tab' + (active ? ' active' : ''), role: 'tab', 'aria-selected': String(active),
        onclick: () => { uiState.cat = c.id; uiState.q = ''; searchInput.value = ''; renderHome(); },
      }, c.label, h('span', { class: 'count' }, String(count(c.id))));
    }));

  const note = q ? h('p', { class: 'results-note' }, list.length + (list.length === 1 ? ' resultado' : ' resultados') + ' para “' + uiState.q.trim() + '”') : null;
  app.replaceChildren(...[
    h('section', { class: 'hero' },
      h('h1', {}, 'Herramientas PDF que trabajan en tu equipo'),
      h('p', {}, 'Une, divide, convierte, firma y protege tus documentos. Todo se procesa en este navegador: ningún archivo se envía a un servidor.')),
    tabs,
    note,
    list.length
      ? h('div', { class: 'grid' }, ...list.map(toolCard))
      : h('div', { class: 'empty' }, 'No encontramos herramientas con esa búsqueda. Prueba con “unir”, “Excel” o “contraseña”.'),
  ].filter(Boolean));
}

/* ---------- Espacio de trabajo ---------- */

const STEP_LABELS = ['Selecciona el archivo', 'Ajusta y procesa', 'Descarga el resultado'];

function computeStep(root) {
  if (root.querySelector('.result')) return 3;
  if (root.querySelector('.files li, .pages .pg, .sub:not(:empty), .ws-pane:not([hidden])')) return 2;
  return 1;
}

/** Reparte los elementos de la herramienta en columna principal y panel lateral de opciones. */
function layoutTool(box) {
  const main = h('div', { class: 'col-main' });
  const side = h('div', { class: 'col-side' });
  [...box.children].forEach((el) => {
    const isSide = el.classList.contains('opts') || el.classList.contains('prog')
      || (el.classList.contains('row') && el.querySelector(':scope > .go'));
    (isSide ? side : main).append(el);
  });
  const cols = h('div', { class: 'tool-cols' }, main);
  if (side.children.length) cols.append(side);
  box.replaceChildren(cols);
  return { main, hasSide: side.children.length > 0 };
}

async function showPreview(main, files) {
  main.querySelector('.preview-card')?.remove();
  main.classList.remove('has-preview');
  if (files.length !== 1) return;
  const f = files[0];
  const body = h('div', { class: 'meta' }, h('b', {}, f.name), h('span', {}, fmtSize(f.size)));
  let thumb = null;
  try {
    if (/\.pdf$/i.test(f.name)) {
      const pdf = await openPdfJs(f);
      thumb = await renderCanvas(pdf, 1, 0.5);
      body.append(h('span', {}, ' · ' + pdf.numPages + (pdf.numPages === 1 ? ' página' : ' páginas')));
    } else if (f.type.startsWith('image/')) {
      thumb = h('img', { src: URL.createObjectURL(f), alt: 'Vista previa' });
    }
  } catch { thumb = null; }
  const card = h('div', { class: 'preview-card' }, thumb || uiIcon('doc', 40), body);
  const anchor = main.querySelector('.drop');
  if (anchor) anchor.after(card); else main.prepend(card);
  main.classList.add('has-preview');
}

function openTool(t) {
  stopObserver();
  const meta = TOOL_UI[t.id];
  document.title = t.title + ' — PDF Privado';
  const box = h('div', { class: 'tool-box' });
  const ws = h('section', { class: 'ws', 'data-step': '1', 'data-tool': t.id });

  const steps = h('ol', { class: 'steps' }, ...STEP_LABELS.map((l, i) => h('li', {}, h('b', {}, String(i + 1)), l)));
  const reset = h('button', { class: 'btn ghost small', hidden: true, onclick: () => openTool(t) }, '↺ Nuevo documento');

  ws.append(
    h('button', { class: 'back', onclick: () => { location.hash = ''; } }, uiIcon('back', 16), 'Todas las herramientas'),
    h('header', { class: 'ws-head' },
      h('span', { class: 'tile c-' + meta.cat }, uiIcon(t.id, 30)),
      h('div', { class: 'grow' }, h('h1', {}, t.title), h('p', {}, t.desc)),
      reset),
    steps, box);
  app.replaceChildren(ws);

  t.render(box);
  const { main, hasSide } = layoutTool(box);
  ws.dataset.hasSide = hasSide ? '1' : '0';

  let shownStep = 0;
  const paintSteps = () => {
    const step = computeStep(ws);
    if (step === shownStep) return; // evita que el observador se realimente
    shownStep = step;
    ws.dataset.step = String(step);
    [...steps.children].forEach((li, i) => {
      li.className = i + 1 < step ? 'done' : i + 1 === step ? 'now' : '';
    });
    if (reset.hidden !== (step === 1)) reset.hidden = step === 1;
  };
  paintSteps();
  uiObserver = new MutationObserver(paintSteps);
  uiObserver.observe(ws, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });

  ws.addEventListener('pdf:files', (e) => {
    if (!['organizar', 'firmar', 'editar', 'censurar', 'comparar'].includes(t.id)) showPreview(main, e.detail.files);
  });
  ws.addEventListener('pdf:reset', () => openTool(t));
}

/* ---------- Instalar como app ---------- */

function renderInstall() {
  stopObserver();
  document.title = 'Descargar app — PDF Privado';
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const status = h('div');
  const steps = h('div');

  const paint = () => {
    const btnHost = [];
    if (uiPwa.installed) {
      status.replaceChildren(h('div', { class: 'msg ok' }, '✔ Ya estás usando PDF Privado como app. Se abre en su propia ventana y funciona sin conexión.'));
    } else if (uiPwa.deferred) {
      status.replaceChildren(h('button', { class: 'btn go', onclick: async () => {
        const e = uiPwa.deferred; uiPwa.deferred = null; e.prompt();
        try { await e.userChoice; } catch { /* cancelado */ }
        paint();
      } }, '[ Instalar PDF Privado ]'));
    } else {
      status.replaceChildren(h('div', { class: 'msg warn' },
        'Tu navegador no ofrece el botón automático. Sigue los pasos de abajo según tu navegador.'));
    }
    steps.replaceChildren(
      h('div', { class: 'install-grid' },
        h('div', { class: 'install-card' + (isSafari ? ' mine' : '') },
          h('h3', {}, 'Safari (macOS Sonoma 14 o superior)'),
          h('ol', {}, h('li', {}, 'Abre esta página en Safari.'),
            h('li', {}, 'En el menú, elige Archivo → Añadir al Dock…'),
            h('li', {}, 'Pulsa Añadir. Aparecerá “PDF Privado” en tu Dock.'))),
        h('div', { class: 'install-card' + (!isSafari ? ' mine' : '') },
          h('h3', {}, 'Chrome, Edge o Brave'),
          h('ol', {}, h('li', {}, 'Pulsa el icono de instalar ⊕ en la barra de direcciones (a la derecha).'),
            h('li', {}, 'O abre el menú ⋮ → Guardar y compartir → Instalar “PDF Privado”.'),
            h('li', {}, 'Se abrirá en su propia ventana y quedará en Launchpad y Dock.')))),
      h('p', { class: 'hint' }, uiPwa.offlineReady
        ? '✔ Los archivos de la app ya están guardados en este navegador: puedes usarla sin internet.'
        : 'La primera vez, abre la app con conexión para que se guarden sus archivos; después funciona sin internet.'));
    void btnHost;
  };
  uiPwa.listeners.clear();
  uiPwa.listeners.add(paint);

  app.replaceChildren(...[
    h('button', { class: 'back', onclick: () => { location.hash = ''; } }, uiIcon('back', 16), 'Todas las herramientas'),
    h('section', { class: 'hero' },
      h('h1', {}, 'Descarga PDF Privado en tu ' + (isMac ? 'Mac' : 'equipo')),
      h('p', {}, 'Instálala como una app: icono en el Dock, ventana propia y funcionamiento sin conexión. Tus documentos se siguen procesando solo en tu equipo.')),
    isMac ? h('div', { class: 'dmg-card' },
      h('div', {},
        h('h3', {}, 'Descargar para Mac (.dmg)'),
        h('p', {}, 'App nativa para Apple Silicon e Intel (macOS 12 o superior). Ábrela y arrastra PDF Privado a Aplicaciones.')),
      h('a', { class: 'btn', href: 'downloads/PDF-Privado-macOS.dmg', download: 'PDF-Privado-macOS.dmg' }, '[ Descargar .dmg ]'),
      h('p', { class: 'hint' }, 'Primera vez: como la app aún no está firmada por un desarrollador de Apple, macOS puede avisar. Haz clic derecho sobre PDF Privado → Abrir → Abrir. Solo se pide una vez.')) : null,
    h('h3', { class: 'alt-title' }, isMac ? 'O instálala desde el navegador (sin descargar nada)' : 'Instalar desde el navegador'),
    status,
    h('div', { class: 'install-facts' },
      h('div', {}, h('b', {}, '🔒 Igual de privada'), h('span', {}, 'La app no sube nada: no hay servidor ni cuentas.')),
      h('div', {}, h('b', {}, '⚡ Sin conexión'), h('span', {}, 'Tras la primera carga, funciona sin internet.')),
      h('div', {}, h('b', {}, '🔄 Siempre al día'), h('span', {}, 'Se actualiza sola cuando hay conexión.')),
      h('div', {}, h('b', {}, '🧹 Fácil de quitar'), h('span', {}, 'Arrástrala a la papelera como cualquier app.'))),
    steps,
  ].filter(Boolean));
  paint();
}

/* ---------- Navegación ---------- */

function route() {
  let id = location.hash.replace('#', '');
  if (id === 'eliminar') { history.replaceState(null, '', '#organizar'); id = 'organizar'; }
  const t = tools.find((x) => x.id === id && TOOL_UI[x.id]);
  if (id === 'app') renderInstall();
  else if (t) openTool(t); else renderHome();
  window.scrollTo(0, 0);
}

searchInput.addEventListener('input', () => {
  uiState.q = searchInput.value;
  if (location.hash) location.hash = ''; else renderHome();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) {
    e.preventDefault(); searchInput.focus();
  } else if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = ''; uiState.q = ''; searchInput.blur();
    if (location.hash) location.hash = ''; else renderHome();
  }
});
document.getElementById('home-link').addEventListener('click', (e) => {
  e.preventDefault();
  uiState.q = ''; searchInput.value = ''; uiState.cat = 'all';
  if (location.hash) location.hash = ''; else renderHome();
});
document.getElementById('app-link').addEventListener('click', () => { uiState.q = ''; searchInput.value = ''; });
window.addEventListener('hashchange', route);
route();
