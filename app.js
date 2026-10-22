/* PDF Privado — todo corre en el navegador. No hay red, ni almacenamiento. */
'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const { PDFDocument, degrees } = PDFLib;
const app = document.getElementById('app');

/* ---------- utilidades ---------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

const baseName = (f) => f.name.replace(/\.[^.]+$/, '');
const readBuf = (f) => f.arrayBuffer();

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function openPdfJs(file) {
  const data = new Uint8Array(await readBuf(file));
  return pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
}

async function openPdfLib(file) {
  try {
    return await PDFDocument.load(await readBuf(file));
  } catch (e) {
    if (/encrypt/i.test(String(e))) {
      throw new Error('"' + file.name + '" está protegido con contraseña. Quita la protección y vuelve a intentarlo.');
    }
    throw new Error('No se pudo leer "' + file.name + '". ¿Es un PDF válido?');
  }
}

async function renderCanvas(pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  // intent "print" no depende de requestAnimationFrame: sigue funcionando con la pestaña en segundo plano.
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
  page.cleanup();
  return canvas;
}

const canvasToBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------- componentes ---------- */

function dropzone({ accept, multiple, label, onFiles }) {
  const input = h('input', { type: 'file', accept, multiple: !!multiple });
  const kind = /image/.test(accept) ? (multiple ? 'Seleccionar imágenes' : 'Seleccionar imagen')
    : /xls|csv/.test(accept) ? 'Seleccionar archivo de Excel'
      : (multiple ? 'Seleccionar archivos PDF' : 'Seleccionar archivo PDF');
  const ico = h('span', { class: 'drop-ico' });
  if (typeof uiIcon === 'function') ico.append(uiIcon('upload', 30));
  const box = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': kind },
    ico,
    h('strong', {}, label),
    h('span', { class: 'drop-btn' }, '[ ' + kind + ' ]'),
    h('span', { class: 'drop-or' }, 'o arrástralos y suéltalos aquí'),
    h('span', { class: 'drop-priv' }, '🔒 Procesamiento 100% privado en tu dispositivo'),
    input);
  const pick = (files) => {
    const list = [...files].filter((f) => accept.split(',').some((a) => {
      a = a.trim().toLowerCase();
      return a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : f.type.startsWith(a.replace('*', ''));
    }));
    if (list.length) {
      const chosen = multiple ? list : [list[0]];
      box.dispatchEvent(new CustomEvent('pdf:files', { bubbles: true, detail: { files: chosen } }));
      onFiles(chosen);
    }
  };
  box.addEventListener('click', () => input.click());
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { pick(input.files); input.value = ''; });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('over'); pick(e.dataTransfer.files); });
  return box;
}

function progressBar() {
  const bar = h('i');
  const label = h('div', { class: 'progress-label' });
  const wrap = h('div', { class: 'prog', hidden: true }, h('div', { class: 'progress' }, bar), label);
  return {
    el: wrap,
    set(done, total, text) {
      wrap.hidden = false;
      bar.style.width = Math.round((done / Math.max(total, 1)) * 100) + '%';
      label.textContent = text || '';
    },
    hide() { wrap.hidden = true; },
  };
}

/**
 * Visor de PDF para la vista previa: renderiza los bytes con pdf.js (todo local) de a una página.
 * Devuelve { el, destroy }; destroy() libera el documento de pdf.js.
 */
function pdfViewer(bytes) {
  let doc = null, cur = 1, gone = false;
  const label = h('span', { class: 'pg-label' });
  const holder = h('div', { class: 'stage-wrap docprev-pages' });
  const prev = h('button', { class: 'btn ghost small', onclick: () => step(-1) }, '◀ Anterior');
  const next = h('button', { class: 'btn ghost small', onclick: () => step(1) }, 'Siguiente ▶');
  const nav = h('div', { class: 'row nav', hidden: true }, prev, label, next);
  const release = () => {
    const d = doc; doc = null;
    if (d) { try { Promise.resolve(d.destroy()).catch(() => {}); } catch { /* ya liberado */ } }
  };

  async function step(d) {
    const n = cur + d;
    if (!doc || n < 1 || n > doc.numPages) return;
    cur = n;
    await showPage();
  }

  async function showPage() {
    const d = doc;
    label.textContent = 'Página ' + cur + ' de ' + d.numPages;
    prev.disabled = cur <= 1;
    next.disabled = cur >= d.numPages;
    const canvas = await renderCanvas(d, cur, 1.2);
    if (!gone) holder.replaceChildren(canvas);
  }

  (async () => {
    try {
      doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      if (gone) { release(); return; }
      nav.hidden = doc.numPages < 2;
      await showPage();
    } catch (e) {
      holder.replaceChildren(h('div', { class: 'msg err' }, 'No se pudo generar la vista previa: ' + (e && e.message ? e.message : e)));
    }
  })();

  return { el: h('div', {}, nav, holder), destroy() { gone = true; release(); } };
}

/** Vista previa de una hoja de cálculo (.xlsx): pestañas por hoja y las primeras filas. */
function xlsxViewer(buf) {
  const MAX_ROWS = 40, MAX_COLS = 14;
  const tabs = h('div', { class: 'row nav' });
  const holder = h('div', { class: 'preview' });
  const el = h('div', {}, tabs, holder);
  try {
    const wb = XLSX.read(buf, { type: 'array' });
    const show = (name) => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
      const rows = aoa.slice(0, MAX_ROWS);
      const width = Math.min(Math.max(1, ...rows.map((r) => r.length)), MAX_COLS);
      holder.replaceChildren(h('table', {}, ...rows.map((r) =>
        h('tr', {}, ...Array.from({ length: width }, (_, i) => h('td', {}, r[i] == null ? '' : String(r[i])))))));
      if (aoa.length > MAX_ROWS) holder.append(h('div', { class: 'hint' }, 'Mostrando ' + MAX_ROWS + ' de ' + aoa.length + ' filas.'));
      [...tabs.children].forEach((b) => b.classList.toggle('active', b.dataset.sheet === name));
    };
    if (wb.SheetNames.length > 1) {
      tabs.append(...wb.SheetNames.slice(0, 30).map((n) => h('button', { class: 'btn ghost small', 'data-sheet': n, onclick: () => show(n) }, n)));
    }
    show(wb.SheetNames[0]);
  } catch (e) {
    holder.replaceChildren(h('div', { class: 'msg err' }, 'No se pudo generar la vista previa: ' + (e && e.message ? e.message : e)));
  }
  return { el, destroy() {} };
}

/** Vista previa de un .zip: lista de archivos y, si son imágenes, miniaturas. */
function zipViewer(blob) {
  const holder = h('div', { class: 'zipprev' }, h('div', { class: 'hint' }, 'Leyendo el contenido…'));
  const urls = [];
  let gone = false;
  (async () => {
    try {
      const zip = await JSZip.loadAsync(blob);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      const items = [];
      for (const f of entries) {
        const isImg = /\.(png|jpe?g)$/i.test(f.name);
        let thumb = null;
        if (isImg && items.length < 60) {
          const b = new Blob([await f.async('uint8array')], { type: /png$/i.test(f.name) ? 'image/png' : 'image/jpeg' });
          const u = URL.createObjectURL(b);
          urls.push(u);
          thumb = h('img', { src: u, alt: f.name });
        }
        items.push(h('figure', {}, thumb || h('div', { class: 'zipdoc' }, '📄'), h('figcaption', {}, f.name)));
      }
      if (gone) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
      holder.replaceChildren(h('div', { class: 'hint' }, entries.length + ' archivo(s) dentro del .zip:'),
        h('div', { class: 'zipgrid' }, ...items));
    } catch (e) {
      holder.replaceChildren(h('div', { class: 'msg err' }, 'No se pudo generar la vista previa: ' + (e && e.message ? e.message : e)));
    }
  })();
  return { el: holder, destroy() { gone = true; urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

/** Vista previa de un .docx (texto) o .pptx (imagen y texto por diapositiva), leyendo su contenido localmente. */
function officeViewer(blob, kind) {
  const urls = [];
  const holder = h('div', { class: 'preview officeprev' }, h('div', { class: 'hint' }, 'Leyendo el documento…'));
  const textOf = (xml, para, run) => {
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    return [...d.getElementsByTagName(para)].map((p) =>
      [...p.getElementsByTagName(run)].map((t) => t.textContent).join('')).filter((t) => t.trim());
  };
  (async () => {
    try {
      const zip = await JSZip.loadAsync(blob);
      const parts = [];
      if (kind === 'docx') {
        const lines = textOf(await zip.file('word/document.xml').async('string'), 'w:p', 'w:t');
        parts.push(h('div', { class: 'hint' }, lines.length + ' párrafo(s) de texto (la vista previa no muestra el diseño):'),
          ...lines.slice(0, 80).map((t) => h('p', {}, t)));
      } else {
        const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
        parts.push(h('div', { class: 'hint' }, names.length + ' diapositiva(s):'));
        for (let i = 0; i < names.length && i < 40; i++) {
          const lines = textOf(await zip.file(names[i]).async('string'), 'a:p', 'a:t');
          parts.push(h('h4', {}, 'Diapositiva ' + (i + 1)));
          const relFile = zip.file(names[i].replace('slides/', 'slides/_rels/') + '.rels');
          const rel = relFile ? await relFile.async('string') : '';
          for (const m of rel.matchAll(/Target="\.\.\/media\/([^"]+\.(?:png|jpe?g))"/gi)) {
            const f = zip.file('ppt/media/' + m[1]);
            if (!f) continue;
            const u = URL.createObjectURL(new Blob([await f.async('uint8array')], { type: /png$/i.test(m[1]) ? 'image/png' : 'image/jpeg' }));
            urls.push(u);
            parts.push(h('img', { src: u, alt: 'Diapositiva ' + (i + 1), class: 'slideimg' }));
          }
          parts.push(...lines.slice(0, 12).map((t) => h('p', {}, t)));
        }
      }
      holder.replaceChildren(...parts);
    } catch (e) {
      holder.replaceChildren(h('div', { class: 'msg err' }, 'No se pudo generar la vista previa: ' + (e && e.message ? e.message : e)));
    }
  })();
  return { el: holder, destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

/** Panel de estado reutilizable: mensajes de error/aviso y resultado con vista previa antes de descargar. */
function statusArea() {
  const el = h('div');
  let viewer = null;
  const dropViewer = () => { if (viewer) { try { viewer.destroy(); } catch { /* ya liberado */ } viewer = null; } };
  return {
    el,
    clear() { dropViewer(); el.replaceChildren(); },
    error(text) { dropViewer(); el.replaceChildren(h('div', { class: 'msg err' }, text)); },
    warn(text) { el.append(h('div', { class: 'msg warn' }, text)); },
    done({ blob, filename, title, detail, extra }) {
      dropViewer();
      const lower = String(filename).toLowerCase();
      const pane = h('div', { class: 'docprev-body' });
      if (lower.endsWith('.pdf')) {
        blob.arrayBuffer().then((buf) => {
          if (el.contains(pane)) { viewer = pdfViewer(new Uint8Array(buf)); pane.replaceChildren(viewer.el); }
        });
      } else if (lower.endsWith('.xlsx')) {
        blob.arrayBuffer().then((buf) => {
          if (el.contains(pane)) { viewer = xlsxViewer(buf); pane.replaceChildren(viewer.el); }
        });
      } else if (lower.endsWith('.zip')) {
        viewer = zipViewer(blob); pane.replaceChildren(viewer.el);
      } else if (/\.(docx|pptx)$/.test(lower)) {
        viewer = officeViewer(blob, lower.slice(-4)); pane.replaceChildren(viewer.el);
      }
      el.replaceChildren(h('div', { class: 'result' },
        h('h3', {}, title || '¡Listo!'),
        h('div', {}, filename + ' · ' + fmtSize(blob.size) + (detail ? ' · ' + detail : '')),
        /\.(pdf|xlsx|zip|docx|pptx)$/.test(lower) ? h('div', { class: 'hint' }, 'Vista previa — revisa que todo esté bien antes de descargar:') : null,
        pane,
        extra || null,
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => download(blob, filename) }, '[ Descargar archivo ]'),
          h('button', { class: 'btn ghost', onclick: () => {
            const box = el.parentElement;
            dropViewer(); el.replaceChildren();
            if (box) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
          } }, '↩ Volver a editar'),
          h('button', { class: 'btn ghost', onclick: (e) => e.target.dispatchEvent(new CustomEvent('pdf:reset', { bubbles: true })) },
            '↺ Procesar otro documento'))));
    },
  };
}

function fileList(files, { reorder, onChange }) {
  const ul = h('ul', { class: 'files' });
  const paint = () => {
    ul.replaceChildren(...files.map((f, i) => h('li', {},
      h('span', { class: 'name' }, f.name),
      h('span', { class: 'size' }, fmtSize(f.size)),
      reorder ? h('button', { class: 'btn ghost small', title: 'Subir', disabled: i === 0,
        onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; paint(); onChange(); } }, '↑') : null,
      reorder ? h('button', { class: 'btn ghost small', title: 'Bajar', disabled: i === files.length - 1,
        onclick: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; paint(); onChange(); } }, '↓') : null,
      h('button', { class: 'btn ghost small', title: 'Quitar',
        onclick: () => { files.splice(i, 1); paint(); onChange(); } }, '✕'))));
  };
  paint();
  return { el: ul, repaint: paint };
}

/** Envuelve la ejecución de una herramienta con manejo de errores y botón deshabilitado. */
function runner(btn, status, fn) {
  return async () => {
    btn.disabled = true;
    status.clear();
    try { await fn(); }
    catch (e) { console.error(e); status.error(e && e.message ? e.message : String(e)); }
    finally { btn.disabled = false; }
  };
}

/* ---------- herramientas ---------- */

const tools = [];

/* 1. Unir */
tools.push({
  id: 'unir', icon: '🧩', title: 'Unir PDF',
  desc: 'Combina varios PDF en uno solo, en el orden que elijas.',
  render(box) {
    const files = [];
    const status = statusArea();
    const prog = progressBar();
    const go = h('button', { class: 'btn go', disabled: true }, 'Unir PDF');
    const list = fileList(files, { reorder: true, onChange: () => { go.disabled = files.length < 2; } });
    const dz = dropzone({
      accept: '.pdf', multiple: true, label: 'Elige los PDF a unir',
      onFiles: (f) => { files.push(...f); list.repaint(); go.disabled = files.length < 2; },
    });
    go.addEventListener('click', runner(go, status, async () => {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        prog.set(i, files.length, 'Procesando ' + files[i].name);
        await tick();
        const src = await openPdfLib(files[i]);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      prog.set(files.length, files.length, 'Guardando…');
      const bytes = await out.save();
      prog.hide();
      status.done({ blob: new Blob([bytes], { type: 'application/pdf' }), filename: 'unido.pdf',
        detail: out.getPageCount() + ' páginas' });
    }));
    box.append(dz, list.el, h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* 2. Dividir */
function parseRanges(text, total) {
  const out = [];
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(part)) { a = b = +part; }
    else throw new Error('Rango no válido: "' + part + '". Usa el formato 1-3, 5, 8-');
    if (a < 1 || b > total || a > b) throw new Error('El rango "' + part + '" queda fuera del documento (tiene ' + total + ' páginas).');
    out.push([a, b]);
  }
  if (!out.length) throw new Error('Escribe al menos un rango de páginas.');
  return out;
}

tools.push({
  id: 'dividir', icon: '✂️', title: 'Dividir PDF',
  desc: 'Extrae páginas o separa el documento en varios archivos.',
  render(box) {
    let file = null, total = 0;
    const status = statusArea();
    const info = h('div', { class: 'sub' });
    const ranges = h('input', { type: 'text', placeholder: 'Ej.: 1-3, 5, 8-' });
    const mode = (v, t, hint, checked) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'modo', value: v, checked }),
      h('span', {}, t, h('div', { class: 'hint' }, hint)));
    const go = h('button', { class: 'btn go', disabled: true }, 'Dividir');
    const opts = h('div', { class: 'opts', hidden: true },
      h('label', {}, h('span', { class: 'lbl' }, 'Páginas'), ranges,
        h('span', { class: 'hint' }, 'Separa con comas. "8-" significa hasta el final.')),
      h('div', {},
        mode('extraer', 'Extraer en un solo PDF', 'Todas las páginas indicadas en un archivo.', true),
        mode('rangos', 'Un archivo por rango (ZIP)', 'Cada rango escrito genera su propio PDF.', false),
        mode('paginas', 'Una página por archivo (ZIP)', 'Ignora los rangos y separa todo el documento.', false)));
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF a dividir',
      onFiles: async ([f]) => {
        status.clear();
        try {
          const doc = await openPdfLib(f);
          file = f; total = doc.getPageCount();
          info.textContent = f.name + ' — ' + total + ' páginas';
          opts.hidden = false; go.disabled = false;
          if (!ranges.value) ranges.value = '1-' + total;
        } catch (e) { status.error(e.message); }
      },
    });
    go.addEventListener('click', runner(go, status, async () => {
      const m = box.querySelector('input[name=modo]:checked').value;
      const src = await openPdfLib(file);
      const make = async (pageNums) => {
        const d = await PDFDocument.create();
        const pages = await d.copyPages(src, pageNums.map((n) => n - 1));
        pages.forEach((p) => d.addPage(p));
        return d.save();
      };
      const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
      if (m === 'extraer') {
        const nums = parseRanges(ranges.value, total).flatMap(([a, b]) => seq(a, b));
        const bytes = await make(nums);
        status.done({ blob: new Blob([bytes], { type: 'application/pdf' }), filename: baseName(file) + '-extracto.pdf',
          detail: nums.length + ' páginas' });
      } else {
        const rs = m === 'paginas' ? seq(1, total).map((n) => [n, n]) : parseRanges(ranges.value, total);
        const zip = new JSZip();
        for (const [a, b] of rs) {
          const label = a === b ? 'p' + a : 'p' + a + '-' + b;
          zip.file(baseName(file) + '-' + label + '.pdf', await make(seq(a, b)));
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        status.done({ blob, filename: baseName(file) + '-dividido.zip', detail: rs.length + ' archivos' });
      }
    }));
    box.append(dz, info, opts, h('div', { class: 'row' }, go), status.el);
  },
});

/* 3. Organizar */
tools.push({
  id: 'organizar', icon: '🗂️', title: 'Organizar y Eliminar Páginas',
  desc: 'Reordena arrastrando, gira o elimina las páginas que no quieres.',
  render(box) {
    let file = null;
    let pages = []; // { orig, rot, canvas }
    let dragIdx = null;
    const status = statusArea();
    const grid = h('div', { class: 'pages' });
    const go = h('button', { class: 'btn go', disabled: true }, 'Guardar PDF');
    const prog = progressBar();

    const paint = () => {
      grid.replaceChildren(...pages.map((p, i) => {
        const card = h('div', { class: 'pg', draggable: 'true' },
          h('div', { class: 'thumb' }, p.canvas),
          h('div', { class: 'num' }, 'Página ' + (p.orig + 1)),
          h('div', { class: 'acts' },
            h('button', { class: 'btn ghost small', title: 'Girar a la izquierda',
              onclick: () => { p.rot = (p.rot + 270) % 360; rot(p); } }, '↺'),
            h('button', { class: 'btn ghost small', title: 'Girar a la derecha',
              onclick: () => { p.rot = (p.rot + 90) % 360; rot(p); } }, '↻'),
            h('button', { class: 'btn ghost small', title: 'Eliminar',
              onclick: () => { pages.splice(i, 1); paint(); go.disabled = !pages.length; } }, '✕')));
        rot(p);
        card.addEventListener('dragstart', (e) => { dragIdx = i; card.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
        card.addEventListener('dragend', () => card.classList.remove('drag'));
        card.addEventListener('dragover', (e) => e.preventDefault());
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragIdx == null || dragIdx === i) return;
          const [m] = pages.splice(dragIdx, 1);
          pages.splice(i, 0, m);
          dragIdx = null;
          paint();
        });
        return card;
      }));
    };
    const rot = (p) => { p.canvas.style.transform = 'rotate(' + p.rot + 'deg)'; };

    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF a organizar',
      onFiles: async ([f]) => {
        status.clear(); pages = []; grid.replaceChildren(); go.disabled = true;
        try {
          file = f;
          const pdf = await openPdfJs(f);
          for (let n = 1; n <= pdf.numPages; n++) {
            prog.set(n - 1, pdf.numPages, 'Generando miniaturas…');
            pages.push({ orig: n - 1, rot: 0, canvas: await renderCanvas(pdf, n, 0.35) });
            if (n % 8 === 0 || n === pdf.numPages) paint();
          }
          prog.hide();
          go.disabled = !pages.length;
        } catch (e) { prog.hide(); status.error('No se pudo abrir el PDF: ' + e.message); }
      },
    });

    go.addEventListener('click', runner(go, status, async () => {
      const src = await openPdfLib(file);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, pages.map((p) => p.orig));
      copied.forEach((cp, i) => {
        const base = cp.getRotation().angle;
        cp.setRotation(degrees((base + pages[i].rot) % 360));
        out.addPage(cp);
      });
      const bytes = await out.save();
      status.done({ blob: new Blob([bytes], { type: 'application/pdf' }), filename: baseName(file) + '-organizado.pdf',
        detail: pages.length + ' páginas' });
    }));
    box.append(dz, prog.el, grid, h('div', { class: 'row' }, go), status.el);
  },
});

/* 4. Comprimir */
const COMPRESS_LEVELS = {
  alta: { scale: 1.6, q: 0.8, name: 'Calidad alta' },
  media: { scale: 1.3, q: 0.65, name: 'Equilibrado' },
  max: { scale: 1.0, q: 0.5, name: 'Máxima compresión' },
};
tools.push({
  id: 'comprimir', icon: '📉', title: 'Comprimir PDF',
  desc: 'Reduce el tamaño del archivo para enviarlo por correo.',
  render(box) {
    let file = null;
    const status = statusArea();
    const prog = progressBar();
    const info = h('div', { class: 'sub' });
    const level = h('select', {}, ...Object.entries(COMPRESS_LEVELS).map(([k, v]) =>
      h('option', { value: k, selected: k === 'media' }, v.name)));
    const go = h('button', { class: 'btn go', disabled: true }, 'Comprimir');
    const opts = h('div', { class: 'opts', hidden: true },
      h('label', {}, h('span', { class: 'lbl' }, 'Nivel'), level),
      h('div', { class: 'msg warn' },
        'La compresión convierte cada página en imagen: el archivo pesa menos, pero el texto deja de poder seleccionarse o buscarse. ' +
        'Si el resultado pesa más que el original, conserva el original.'));
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF a comprimir',
      onFiles: ([f]) => { file = f; info.textContent = f.name + ' — ' + fmtSize(f.size); opts.hidden = false; go.disabled = false; status.clear(); },
    });
    go.addEventListener('click', runner(go, status, async () => {
      const cfg = COMPRESS_LEVELS[level.value];
      const pdf = await openPdfJs(file);
      const out = await PDFDocument.create();
      for (let n = 1; n <= pdf.numPages; n++) {
        prog.set(n - 1, pdf.numPages, 'Comprimiendo página ' + n + ' de ' + pdf.numPages);
        await tick();
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const canvas = await renderCanvas(pdf, n, cfg.scale);
        const jpg = await canvasToBlob(canvas, 'image/jpeg', cfg.q);
        const img = await out.embedJpg(await jpg.arrayBuffer());
        const pg = out.addPage([base.width, base.height]);
        pg.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
        canvas.width = canvas.height = 0;
      }
      prog.hide();
      const bytes = await out.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const pct = Math.round((1 - blob.size / file.size) * 100);
      status.done({
        blob, filename: baseName(file) + '-comprimido.pdf',
        detail: pct > 0 ? 'ahorro del ' + pct + '% (antes ' + fmtSize(file.size) + ')' : 'no se redujo (original ' + fmtSize(file.size) + ')',
      });
      if (pct <= 0) status.warn('El resultado no es más pequeño que el original. Prueba un nivel más alto de compresión o conserva el original.');
    }));
    box.append(dz, info, opts, h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* 5. PDF a imágenes */
tools.push({
  id: 'pdf-imagenes', icon: '🖼️', title: 'PDF a imágenes',
  desc: 'Convierte cada página en una imagen JPG o PNG (ZIP).',
  render(box) {
    let file = null;
    const status = statusArea();
    const prog = progressBar();
    const info = h('div', { class: 'sub' });
    const fmt = h('select', {}, h('option', { value: 'jpg' }, 'JPG (más ligero)'), h('option', { value: 'png' }, 'PNG (sin pérdida)'));
    const res = h('select', {},
      h('option', { value: '1.5' }, 'Normal (≈110 ppp)'),
      h('option', { value: '2', selected: true }, 'Alta (≈145 ppp)'),
      h('option', { value: '3' }, 'Muy alta (≈215 ppp)'));
    const go = h('button', { class: 'btn go', disabled: true }, 'Convertir');
    const opts = h('div', { class: 'opts', hidden: true },
      h('label', {}, h('span', { class: 'lbl' }, 'Formato'), fmt),
      h('label', {}, h('span', { class: 'lbl' }, 'Resolución'), res));
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF',
      onFiles: ([f]) => { file = f; info.textContent = f.name; opts.hidden = false; go.disabled = false; status.clear(); },
    });
    go.addEventListener('click', runner(go, status, async () => {
      const pdf = await openPdfJs(file);
      const zip = new JSZip();
      const ext = fmt.value, type = ext === 'png' ? 'image/png' : 'image/jpeg';
      const pad = String(pdf.numPages).length;
      for (let n = 1; n <= pdf.numPages; n++) {
        prog.set(n - 1, pdf.numPages, 'Página ' + n + ' de ' + pdf.numPages);
        await tick();
        const canvas = await renderCanvas(pdf, n, +res.value);
        const blob = await canvasToBlob(canvas, type, 0.92);
        zip.file(baseName(file) + '-' + String(n).padStart(pad, '0') + '.' + ext, blob);
        canvas.width = canvas.height = 0;
      }
      prog.set(1, 1, 'Empaquetando…');
      const blob = await zip.generateAsync({ type: 'blob' });
      prog.hide();
      status.done({ blob, filename: baseName(file) + '-imagenes.zip', detail: pdf.numPages + ' imágenes' });
    }));
    box.append(dz, info, opts, h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* 6. Imágenes a PDF */
tools.push({
  id: 'imagenes-pdf', icon: '📸', title: 'Imágenes a PDF',
  desc: 'Junta fotos o escaneos JPG/PNG en un solo PDF.',
  render(box) {
    const files = [];
    const status = statusArea();
    const prog = progressBar();
    const size = h('select', {}, h('option', { value: 'img' }, 'Del tamaño de cada imagen'), h('option', { value: 'a4' }, 'Página A4 (imagen ajustada)'));
    const go = h('button', { class: 'btn go', disabled: true }, 'Crear PDF');
    const list = fileList(files, { reorder: true, onChange: () => { go.disabled = !files.length; } });
    const dz = dropzone({
      accept: 'image/*', multiple: true, label: 'Elige las imágenes',
      onFiles: (f) => { files.push(...f); list.repaint(); go.disabled = !files.length; },
    });
    const toPng = async (file) => {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return (await canvasToBlob(c, 'image/png')).arrayBuffer();
    };
    go.addEventListener('click', runner(go, status, async () => {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        prog.set(i, files.length, files[i].name);
        await tick();
        const f = files[i];
        const buf = await readBuf(f);
        let img;
        if (f.type === 'image/jpeg') img = await out.embedJpg(buf);
        else if (f.type === 'image/png') img = await out.embedPng(buf);
        else img = await out.embedPng(await toPng(f));
        let pw = img.width, ph = img.height, x = 0, y = 0, w = img.width, hh = img.height;
        if (size.value === 'a4') {
          const land = img.width > img.height;
          pw = land ? 841.89 : 595.28; ph = land ? 595.28 : 841.89;
          const m = 24, k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
          w = img.width * k; hh = img.height * k; x = (pw - w) / 2; y = (ph - hh) / 2;
        }
        out.addPage([pw, ph]).drawImage(img, { x, y, width: w, height: hh });
      }
      prog.hide();
      const bytes = await out.save();
      status.done({ blob: new Blob([bytes], { type: 'application/pdf' }), filename: 'imagenes.pdf', detail: files.length + ' páginas' });
    }));
    box.append(dz, list.el,
      h('div', { class: 'opts' }, h('label', {}, h('span', { class: 'lbl' }, 'Tamaño de página'), size)),
      h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* 7. PDF a Excel */

/** Agrupa fragmentos de texto {s,x,y,w,h} (y hacia arriba) en filas de celdas. */
function groupItems(items) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, it.h * 0.5)) last.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    const cells = [];
    let cur = null;
    for (const it of r.items) {
      if (cur) {
        const gap = it.x - (cur.x + cur.w);
        if (gap <= Math.max(cur.h, it.h) * 0.6) {
          cur.s += (gap > it.h * 0.1 ? ' ' : '') + it.s;
          cur.w = it.x + it.w - cur.x;
          continue;
        }
        cells.push(cur);
      }
      cur = { s: it.s, x: it.x, w: it.w, h: it.h };
    }
    if (cur) cells.push(cur);
    return cells.map((c) => ({ ...c, s: c.s.replace(/\s+/g, ' ').trim() }));
  });
}

/** Filas de una página a partir del texto incrustado en el PDF. */
async function extractRows(page) {
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    items.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10 });
  }
  return groupItems(items);
}

/* ---------- OCR (Tesseract, todo en local) ---------- */

const OCR_SCALE = 3; // ≈ 215 ppp: buen equilibrio entre precisión y velocidad

const ocrLangSelect = () => h('select', {},
  h('option', { value: 'spa' }, 'Español'),
  h('option', { value: 'eng' }, 'Inglés'),
  h('option', { value: 'spa+eng' }, 'Español + Inglés'));

async function createOcr(lang, onStatus) {
  const abs = (p) => new URL(p, location.href).href;
  return Tesseract.createWorker(lang, 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract'),
    langPath: abs('vendor/tessdata'),
    workerBlobURL: false,
    gzip: true,
    logger: (m) => { if (onStatus && m.status) onStatus(m.status, m.progress || 0); },
  });
}

/** Reconoce una página; devuelve palabras en puntos PDF (origen arriba-izquierda) y el canvas. */
async function ocrPage(worker, pdf, n, keepCanvas) {
  const canvas = await renderCanvas(pdf, n, OCR_SCALE);
  const res = await worker.recognize(canvas, {}, { blocks: true, text: true, tsv: true });
  let words = res.data.words;
  if (!words && res.data.blocks) {
    words = res.data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  }
  words = (words || []).filter((w) => w.text && w.text.trim() && w.confidence > 30).map((w) => ({
    s: w.text, x0: w.bbox.x0 / OCR_SCALE, y0: w.bbox.y0 / OCR_SCALE, x1: w.bbox.x1 / OCR_SCALE, y1: w.bbox.y1 / OCR_SCALE,
  }));
  if (!keepCanvas) canvas.width = canvas.height = 0;
  return { words, canvas };
}

function ocrWordsToRows(words) {
  return groupItems(words.map((w) => ({ s: w.s, x: w.x0, y: -w.y1, w: w.x1 - w.x0, h: w.y1 - w.y0 })));
}

function clusterColumns(xs, tol) {
  const sorted = [...new Set(xs.map((x) => Math.round(x * 2) / 2))].sort((a, b) => a - b);
  const centers = [];
  let prev = null;
  for (const x of sorted) {
    if (prev === null || x - prev > tol) centers.push(x);
    prev = x;
  }
  return centers;
}

function colIndex(centers, x) {
  let idx = 0;
  for (let i = 0; i < centers.length; i++) { if (centers[i] <= x + 0.5) idx = i; else break; }
  return idx;
}

function parseNumber(s, mode) {
  if (mode === 'texto') return s;
  let t = s.replace(/[\s$€£]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (mode === 'us') { if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(t)) return s; t = t.replace(/,/g, ''); }
  else { if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(t)) return s; t = t.replace(/\./g, '').replace(',', '.'); }
  const n = parseFloat(t);
  if (!isFinite(n)) return s;
  // Evita convertir códigos con ceros a la izquierda (ej. 00123, teléfonos).
  if (/^0\d/.test(t.replace('-', ''))) return s;
  return neg ? -n : n;
}

tools.push({
  id: 'pdf-excel', icon: '📊', title: 'PDF a Excel',
  desc: 'Extrae tablas y datos de un PDF a una hoja de cálculo (.xlsx).',
  render(box) {
    let file = null;
    const status = statusArea();
    const prog = progressBar();
    const info = h('div', { class: 'sub' });
    const sel = (opts, def) => h('select', {}, ...opts.map(([v, t]) => h('option', { value: v, selected: v === def }, t)));
    const sheets = sel([['una', 'Todo en una sola hoja'], ['varias', 'Una hoja por página']], 'una');
    const cols = sel([['normal', 'Normal'], ['estricta', 'Estricta (más columnas)'], ['flexible', 'Flexible (menos columnas)']], 'normal');
    const nums = sel([['us', '1,234.56 (coma para miles)'], ['eu', '1.234,56 (punto para miles)'], ['texto', 'Dejar todo como texto']], 'us');
    const ocrMode = sel([['auto', 'Automático (solo si el PDF no tiene texto)'], ['si', 'Siempre (PDF escaneado)'], ['no', 'Nunca']], 'auto');
    const ocrLang = ocrLangSelect();
    const go = h('button', { class: 'btn go', disabled: true }, 'Convertir a Excel');
    const opts = h('div', { class: 'opts', hidden: true },
      h('label', {}, h('span', { class: 'lbl' }, 'Reconocimiento de texto (OCR)'), ocrMode,
        h('span', { class: 'hint' }, 'Para PDF escaneados o fotos. Es más lento: puede tardar unos segundos por página.')),
      h('label', {}, h('span', { class: 'lbl' }, 'Idioma del documento (OCR)'), ocrLang),
      h('label', {}, h('span', { class: 'lbl' }, 'Hojas'), sheets),
      h('label', {}, h('span', { class: 'lbl' }, 'Detección de columnas'), cols,
        h('span', { class: 'hint' }, 'Si ves columnas partidas, prueba "Flexible". Si se juntan datos, prueba "Estricta".')),
      h('label', {}, h('span', { class: 'lbl' }, 'Formato de números'), nums));
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF con la tabla',
      onFiles: ([f]) => { file = f; info.textContent = f.name + ' — ' + fmtSize(f.size); opts.hidden = false; go.disabled = false; status.clear(); },
    });

    go.addEventListener('click', runner(go, status, async () => {
      const tol = { estricta: 4, normal: 8, flexible: 16 }[cols.value];
      const pdf = await openPdfJs(file);
      let perPage = [];
      let textItems = 0;
      let usedOcr = false;
      if (ocrMode.value !== 'si') {
        for (let n = 1; n <= pdf.numPages; n++) {
          prog.set(n - 1, pdf.numPages, 'Leyendo página ' + n + ' de ' + pdf.numPages);
          await tick();
          const rows = await extractRows(await pdf.getPage(n));
          textItems += rows.reduce((a, r) => a + r.length, 0);
          perPage.push(rows);
        }
      }
      if (ocrMode.value === 'si' || (!textItems && ocrMode.value === 'auto')) {
        usedOcr = true;
        perPage = [];
        textItems = 0;
        prog.set(0, pdf.numPages, 'Preparando OCR…');
        const worker = await createOcr(ocrLang.value);
        try {
          for (let n = 1; n <= pdf.numPages; n++) {
            prog.set(n - 1, pdf.numPages, 'OCR página ' + n + ' de ' + pdf.numPages + '…');
            const { words } = await ocrPage(worker, pdf, n, false);
            const rows = ocrWordsToRows(words);
            textItems += rows.reduce((a, r) => a + r.length, 0);
            perPage.push(rows);
          }
        } finally { await worker.terminate(); }
      }
      prog.hide();
      if (!textItems) {
        throw new Error(ocrMode.value === 'no'
          ? 'Este PDF no contiene texto seleccionable (parece un escaneo). Activa el reconocimiento de texto (OCR) y vuelve a intentarlo.'
          : 'No se pudo reconocer texto en este documento. Revisa que el idioma elegido sea el correcto y que la imagen sea legible.');
      }

      const toAoa = (groups, centers) => {
        const aoa = [];
        for (const rows of groups) {
          for (const cells of rows) {
            const line = [];
            for (const c of cells) {
              const i = colIndex(centers, c.x);
              const v = parseNumber(c.s, nums.value);
              line[i] = line[i] == null ? v : String(line[i]) + ' ' + c.s;
            }
            aoa.push(Array.from(line, (v) => (v === undefined ? '' : v)));
          }
        }
        return aoa;
      };
      const wb = XLSX.utils.book_new();
      const allAoa = [];
      if (sheets.value === 'una') {
        const centers = clusterColumns(perPage.flat(2).map((c) => c.x), tol);
        const aoa = toAoa(perPage, centers);
        allAoa.push(aoa);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Datos');
      } else {
        perPage.forEach((rows, i) => {
          const aoa = toAoa([rows], clusterColumns(rows.flat().map((c) => c.x), tol));
          allAoa.push(aoa);
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [[]]), 'Página ' + (i + 1));
        });
      }
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      status.done({
        blob, filename: baseName(file) + '.xlsx',
        detail: allAoa.reduce((a, x) => a + x.length, 0) + ' filas' + (usedOcr ? ' · leído con OCR' : ''),
        extra: usedOcr ? h('div', { class: 'msg warn' }, 'El texto se reconoció con OCR: revisa números y nombres, pueden contener errores de lectura.') : null,
      });
    }));
    box.append(dz, info, opts, h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* 8. OCR: PDF escaneado -> PDF con texto seleccionable */
tools.push({
  id: 'ocr', icon: '🔍', title: 'OCR: PDF escaneado a PDF buscable',
  desc: 'Reconoce el texto de un escaneo y lo hace seleccionable y buscable.',
  render(box) {
    let file = null;
    const status = statusArea();
    const prog = progressBar();
    const info = h('div', { class: 'sub' });
    const lang = ocrLangSelect();
    const go = h('button', { class: 'btn go', disabled: true }, 'Reconocer texto');
    const opts = h('div', { class: 'opts', hidden: true },
      h('label', {}, h('span', { class: 'lbl' }, 'Idioma del documento'), lang),
      h('div', { class: 'msg warn' }, 'Mantiene la imagen original de cada página y agrega una capa de texto invisible. ' +
        'Es lento (unos segundos por página) y el reconocimiento puede tener errores en escaneos de baja calidad.'));
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF escaneado',
      onFiles: ([f]) => { file = f; info.textContent = f.name + ' — ' + fmtSize(f.size); opts.hidden = false; go.disabled = false; status.clear(); },
    });
    go.addEventListener('click', runner(go, status, async () => {
      const pdf = await openPdfJs(file);
      const out = await PDFDocument.create();
      const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
      const winAnsi = (t) => [...t].filter((c) => { try { font.encodeText(c); return true; } catch { return false; } }).join('');
      let total = 0;
      prog.set(0, pdf.numPages, 'Preparando OCR…');
      const worker = await createOcr(lang.value);
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          prog.set(n - 1, pdf.numPages, 'OCR página ' + n + ' de ' + pdf.numPages + '…');
          const base = (await pdf.getPage(n)).getViewport({ scale: 1 });
          const { words, canvas } = await ocrPage(worker, pdf, n, true);
          const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.85);
          canvas.width = canvas.height = 0;
          const img = await out.embedJpg(await jpg.arrayBuffer());
          const page = out.addPage([base.width, base.height]);
          page.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
          for (const w of words) {
            const t = winAnsi(w.s);
            if (!t) continue;
            const size = Math.max(4, (w.y1 - w.y0) * 0.85);
            page.drawText(t, { x: w.x0, y: base.height - w.y1 + (w.y1 - w.y0) * 0.2, size, font, opacity: 0 });
            total++;
          }
        }
      } finally { await worker.terminate(); }
      prog.hide();
      if (!total) throw new Error('No se reconoció texto. Revisa el idioma elegido y la calidad del escaneo.');
      const bytes = await out.save();
      status.done({ blob: new Blob([bytes], { type: 'application/pdf' }), filename: baseName(file) + '-ocr.pdf',
        detail: pdf.numPages + ' páginas · ' + total + ' palabras' });
    }));
    box.append(dz, info, opts, h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* ---------- navegación ---------- */

/* La navegación y la presentación (catálogo, pasos, búsqueda) viven en ui/shell.js. */
