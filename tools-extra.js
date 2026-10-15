/* PDF Privado — herramientas adicionales. Se carga después de app.js. */
'use strict';

const { rgb, StandardFonts } = PDFLib;

/* ---------- ayudas ---------- */

const field = (label, control, hint) => h('label', {},
  h('span', { class: 'lbl' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
const selectEl = (list, def) => h('select', {},
  ...list.map(([v, t]) => h('option', { value: v, selected: v === def }, t)));
const textEl = (ph, val, type) => h('input', { type: type || 'text', placeholder: ph || '', value: val || '' });
const numEl = (val, min, max, step) => h('input', { type: 'number', value: String(val), min, max, step: step || 1 });
const checkEl = (label, checked) => {
  const i = h('input', { type: 'checkbox', checked: !!checked });
  return { input: i, el: h('label', { class: 'radio' }, i, h('span', {}, label)) };
};

const COLORS = {
  negro: rgb(0, 0, 0), gris: rgb(0.45, 0.45, 0.45), rojo: rgb(0.8, 0.1, 0.1),
  azul: rgb(0.1, 0.25, 0.75), verde: rgb(0.05, 0.5, 0.2),
};
const colorOptions = [['negro', 'Negro'], ['gris', 'Gris'], ['rojo', 'Rojo'], ['azul', 'Azul'], ['verde', 'Verde']];
const CSS_COLORS = { negro: '#000', gris: '#737373', rojo: '#cc1a1a', azul: '#1a40bf', verde: '#0d8033' };

/** Quita los caracteres que la fuente estándar no puede dibujar. */
const safeText = (font, t) => [...t].filter((c) => { try { font.encodeText(c); return true; } catch { return false; } }).join('');

/** Geometría de la vista (con la rotación de la página) → espacio de usuario del PDF. */
function viewDims(page) {
  const { width: W, height: H } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return { W, H, r, vw: r % 180 ? H : W, vh: r % 180 ? W : H };
}
function viewToUser(r, W, H, u, v) {
  switch (r) {
    case 90: return { x: v, y: u };
    case 180: return { x: W - u, y: v };
    case 270: return { x: W - v, y: H - u };
    default: return { x: u, y: H - v };
  }
}

const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

/** Construye una herramienta de "un PDF + opciones + botón". */
function pdfTool(def) {
  return {
    id: def.id, icon: def.icon, title: def.title, desc: def.desc, cat: def.cat,
    render(box) {
      let file = null;
      const status = statusArea();
      const prog = progressBar();
      const info = h('div', { class: 'sub' });
      const o = def.options ? def.options() : { el: [], get: () => ({}) };
      const go = h('button', { class: 'btn go', disabled: true }, def.action || 'Procesar');
      const opts = h('div', { class: 'opts', hidden: true }, ...[].concat(o.el || []));
      const dz = dropzone({
        accept: def.accept || '.pdf', label: def.label || 'Elige el PDF',
        onFiles: async ([f]) => {
          status.clear();
          file = f;
          info.textContent = f.name + ' — ' + fmtSize(f.size);
          opts.hidden = false; go.disabled = false;
          if (o.fill) { try { await o.fill(f); } catch (e) { status.error(e.message); } }
        },
      });
      go.addEventListener('click', runner(go, status, async () => {
        const r = await def.run({ file, opts: o.get(), prog, status });
        prog.hide();
        const blob = r.blob || pdfBlob(r.bytes);
        status.done({ blob, filename: r.filename, detail: r.detail, extra: r.extra });
        if (r.warn) status.warn(r.warn);
      }));
      box.append(dz, info, opts, h('div', { class: 'row' }, go), prog.el, status.el);
    },
  };
}

function pageSet(text, n) {
  const set = new Set();
  if (text.trim()) parseRanges(text, n).forEach(([a, b]) => { for (let i = a; i <= b; i++) set.add(i - 1); });
  return set;
}

/** Rasteriza un documento de pdf.js a un PDF nuevo (opcionalmente con capa de texto OCR). */
async function rasterPdf(pdf, { scale = 2, q = 0.85, prog, ocr, label = 'Procesando' }) {
  const out = await PDFDocument.create();
  let worker = null, font = null;
  if (ocr) {
    prog.set(0, pdf.numPages, 'Preparando OCR…');
    worker = await createOcr(ocr);
    font = await out.embedFont(StandardFonts.Helvetica);
  }
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      prog.set(n - 1, pdf.numPages, label + ' página ' + n + ' de ' + pdf.numPages + '…');
      await tick();
      const base = (await pdf.getPage(n)).getViewport({ scale: 1 });
      let canvas, words = [];
      if (ocr) ({ canvas, words } = await ocrPage(worker, pdf, n, true));
      else canvas = await renderCanvas(pdf, n, scale);
      const jpg = await canvasToBlob(canvas, 'image/jpeg', q);
      canvas.width = canvas.height = 0;
      const img = await out.embedJpg(await jpg.arrayBuffer());
      const page = out.addPage([base.width, base.height]);
      page.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      for (const w of words) {
        const t = safeText(font, w.s);
        if (!t) continue;
        const size = Math.max(4, (w.y1 - w.y0) * 0.85);
        page.drawText(t, { x: w.x0, y: base.height - w.y1 + (w.y1 - w.y0) * 0.2, size, font, opacity: 0 });
      }
    }
  } finally { if (worker) await worker.terminate(); }
  return out.save();
}

/* ---------- organizar ---------- */

const extra = [];

extra.push(pdfTool({
  id: 'girar', icon: '🔄', title: 'Girar PDF', cat: 'organizar', action: 'Girar',
  desc: 'Gira todas las páginas o solo algunas.',
  options() {
    const ang = selectEl([['90', '90° a la derecha'], ['270', '90° a la izquierda'], ['180', '180°']], '90');
    const pages = textEl('Todas (o ej.: 1-3, 5)');
    return { el: [field('Giro', ang), field('Páginas', pages, 'Déjalo vacío para girar todas.')], get: () => ({ ang: +ang.value, pages: pages.value }) };
  },
  async run({ file, opts }) {
    const doc = await openPdfLib(file);
    const set = pageSet(opts.pages, doc.getPageCount());
    doc.getPages().forEach((p, i) => {
      if (!set.size || set.has(i)) p.setRotation(PDFLib.degrees((p.getRotation().angle + opts.ang) % 360));
    });
    return { bytes: await doc.save(), filename: baseName(file) + '-girado.pdf', detail: set.size ? set.size + ' páginas giradas' : 'todas las páginas' };
  },
}));

extra.push(pdfTool({
  id: 'eliminar', icon: '🗑️', title: 'Eliminar páginas', cat: 'organizar', action: 'Eliminar páginas',
  desc: 'Quita las páginas que no necesitas.',
  options() {
    const pages = textEl('Ej.: 2, 4-6');
    return { el: [field('Páginas a eliminar', pages, 'Separa con comas. "8-" significa hasta el final.')], get: () => ({ pages: pages.value }) };
  },
  async run({ file, opts }) {
    const doc = await openPdfLib(file);
    const n = doc.getPageCount();
    const set = pageSet(opts.pages, n);
    if (!set.size) throw new Error('Escribe qué páginas quieres eliminar.');
    if (set.size >= n) throw new Error('No puedes eliminar todas las páginas del documento.');
    [...set].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
    return { bytes: await doc.save(), filename: baseName(file) + '-sin-paginas.pdf', detail: set.size + ' eliminadas · quedan ' + doc.getPageCount() };
  },
}));

extra.push(pdfTool({
  id: 'numerar', icon: '🔢', title: 'Numerar páginas', cat: 'editar', action: 'Numerar',
  desc: 'Añade el número de página en cada hoja.',
  options() {
    const pos = selectEl([['bc', 'Abajo, centro'], ['br', 'Abajo, derecha'], ['bl', 'Abajo, izquierda'],
      ['tc', 'Arriba, centro'], ['tr', 'Arriba, derecha'], ['tl', 'Arriba, izquierda']], 'bc');
    const fmt = selectEl([['{n}', '1'], ['Página {n}', 'Página 1'], ['Página {n} de {total}', 'Página 1 de 10'], ['{n} / {total}', '1 / 10']], 'Página {n} de {total}');
    const start = numEl(1, 0, 9999);
    const size = numEl(11, 6, 40);
    const skip = checkEl('No numerar la primera página (portada)', false);
    return {
      el: [field('Posición', pos), field('Formato', fmt), field('Empezar en', start), field('Tamaño de letra', size), skip.el],
      get: () => ({ pos: pos.value, fmt: fmt.value, start: +start.value, size: +size.value, skip: skip.input.checked }),
    };
  },
  async run({ file, opts }) {
    const doc = await openPdfLib(file);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const total = doc.getPageCount();
    doc.getPages().forEach((p, i) => {
      if (opts.skip && i === 0) return;
      const num = opts.start + (opts.skip ? i - 1 : i);
      const last = opts.start + total - 1 - (opts.skip ? 1 : 0);
      const text = opts.fmt.replace('{n}', num).replace('{total}', last);
      const { W, H, r, vw, vh } = viewDims(p);
      const w = font.widthOfTextAtSize(text, opts.size);
      const m = 28;
      const u = opts.pos[1] === 'c' ? (vw - w) / 2 : opts.pos[1] === 'l' ? m : vw - m - w;
      const v = opts.pos[0] === 'b' ? vh - m : m + opts.size;
      const { x, y } = viewToUser(r, W, H, u, v);
      p.drawText(text, { x, y, size: opts.size, font, color: rgb(0.1, 0.1, 0.1), rotate: PDFLib.degrees(r) });
    });
    return { bytes: await doc.save(), filename: baseName(file) + '-numerado.pdf', detail: total + ' páginas' };
  },
}));

extra.push(pdfTool({
  id: 'marca-agua', icon: '💧', title: 'Marca de agua', cat: 'editar', action: 'Aplicar marca de agua',
  desc: 'Estampa un texto como "CONFIDENCIAL" en todas las páginas.',
  options() {
    const text = textEl('Ej.: CONFIDENCIAL', 'CONFIDENCIAL');
    const size = numEl(64, 10, 200);
    const op = selectEl([['0.15', 'Muy suave'], ['0.25', 'Suave'], ['0.4', 'Media'], ['0.6', 'Fuerte']], '0.25');
    const ang = selectEl([['45', 'Diagonal'], ['0', 'Horizontal']], '45');
    const color = selectEl(colorOptions.slice(1), 'gris');
    return {
      el: [field('Texto', text), field('Tamaño de letra', size), field('Intensidad', op), field('Orientación', ang), field('Color', color)],
      get: () => ({ text: text.value, size: +size.value, op: +op.value, ang: +ang.value, color: color.value }),
    };
  },
  async run({ file, opts }) {
    if (!opts.text.trim()) throw new Error('Escribe el texto de la marca de agua.');
    const doc = await openPdfLib(file);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const t = safeText(font, opts.text.trim());
    if (!t) throw new Error('El texto contiene caracteres no compatibles.');
    const a = (opts.ang * Math.PI) / 180;
    const w = font.widthOfTextAtSize(t, opts.size);
    doc.getPages().forEach((p) => {
      const { W, H, r, vw, vh } = viewDims(p);
      const u = vw / 2 - (Math.cos(a) * w) / 2 + Math.sin(a) * opts.size * 0.3;
      const v = vh / 2 + (Math.sin(a) * w) / 2 + Math.cos(a) * opts.size * 0.3;
      const { x, y } = viewToUser(r, W, H, u, v);
      p.drawText(t, { x, y, size: opts.size, font, color: COLORS[opts.color], opacity: opts.op, rotate: PDFLib.degrees(r + opts.ang) });
    });
    return { bytes: await doc.save(), filename: baseName(file) + '-marca.pdf', detail: doc.getPageCount() + ' páginas' };
  },
}));

extra.push(pdfTool({
  id: 'recortar', icon: '✂️', title: 'Recortar PDF', cat: 'editar', action: 'Recortar',
  desc: 'Quita márgenes de todas las páginas.',
  options() {
    const m = { top: numEl(10, 0, 200), right: numEl(10, 0, 200), bottom: numEl(10, 0, 200), left: numEl(10, 0, 200) };
    return {
      el: [h('div', { class: 'hint' }, 'Milímetros que se quitan de cada borde:'),
        field('Arriba', m.top), field('Derecha', m.right), field('Abajo', m.bottom), field('Izquierda', m.left)],
      get: () => Object.fromEntries(Object.entries(m).map(([k, el]) => [k, (+el.value || 0) * 72 / 25.4])),
    };
  },
  async run({ file, opts }) {
    const doc = await openPdfLib(file);
    doc.getPages().forEach((p) => {
      const { W, H, r, vw, vh } = viewDims(p);
      const cw = vw - opts.left - opts.right, ch = vh - opts.top - opts.bottom;
      if (cw < 20 || ch < 20) throw new Error('Los márgenes son demasiado grandes para el tamaño de la página.');
      const a = viewToUser(r, W, H, opts.left, opts.top);
      const b = viewToUser(r, W, H, opts.left + cw, opts.top + ch);
      p.setCropBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    });
    return { bytes: await doc.save(), filename: baseName(file) + '-recortado.pdf', detail: doc.getPageCount() + ' páginas' };
  },
}));

/* ---------- optimizar y reparar ---------- */

extra.push(pdfTool({
  id: 'reparar', icon: '🛠️', title: 'Reparar PDF', cat: 'optimizar', action: 'Reparar',
  desc: 'Reconstruye un PDF dañado o que no abre bien.',
  async run({ file, prog }) {
    const buf = await readBuf(file);
    try {
      const src = await PDFDocument.load(buf, { throwOnInvalidObject: false, updateMetadata: false });
      const out = await PDFDocument.create();
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      return { bytes: await out.save(), filename: baseName(file) + '-reparado.pdf', detail: out.getPageCount() + ' páginas reconstruidas' };
    } catch (e) {
      let pdf;
      try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; }
      catch { throw new Error('No se pudo reparar: el archivo está demasiado dañado o no es un PDF.'); }
      const bytes = await rasterPdf(pdf, { scale: 2, prog, label: 'Recuperando' });
      return { bytes, filename: baseName(file) + '-reparado.pdf', detail: pdf.numPages + ' páginas recuperadas como imagen',
        warn: 'La estructura original no se pudo reconstruir; las páginas se recuperaron como imágenes (el texto ya no es seleccionable).' };
    }
  },
}));

extra.push(pdfTool({
  id: 'metadatos', icon: '🧹', title: 'Metadatos del PDF', cat: 'seguridad', action: 'Guardar PDF',
  desc: 'Ve y edita o borra autor, título y otros datos ocultos.',
  options() {
    const f = { title: textEl(), author: textEl(), subject: textEl(), keywords: textEl(), creator: textEl(), producer: textEl() };
    const clear = checkEl('Borrar todos los metadatos (recomendado antes de compartir)', false);
    return {
      el: [field('Título', f.title), field('Autor', f.author), field('Asunto', f.subject), field('Palabras clave', f.keywords),
        field('Creado con', f.creator), field('Convertido con', f.producer), clear.el],
      get: () => ({ ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), clear: clear.input.checked }),
      async fill(file) {
        const d = await PDFDocument.load(await readBuf(file), { updateMetadata: false });
        f.title.value = d.getTitle() || ''; f.author.value = d.getAuthor() || ''; f.subject.value = d.getSubject() || '';
        f.keywords.value = d.getKeywords() || ''; f.creator.value = d.getCreator() || ''; f.producer.value = d.getProducer() || '';
      },
    };
  },
  async run({ file, opts }) {
    const d = await PDFDocument.load(await readBuf(file), { updateMetadata: false });
    const v = opts.clear ? { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' } : opts;
    d.setTitle(v.title); d.setAuthor(v.author); d.setSubject(v.subject);
    d.setKeywords(v.keywords ? v.keywords.split(',').map((s) => s.trim()).filter(Boolean) : []);
    d.setCreator(v.creator); d.setProducer(v.producer);
    if (opts.clear) {
      d.catalog.delete(PDFLib.PDFName.of('Metadata'));
    }
    return { bytes: await d.save({ updateFieldAppearances: false }), filename: baseName(file) + '-limpio.pdf', detail: opts.clear ? 'metadatos borrados' : 'metadatos actualizados' };
  },
}));

/* ---------- convertir desde PDF ---------- */

const xmlEsc = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

extra.push(pdfTool({
  id: 'pdf-word', icon: '📝', title: 'PDF a Word', cat: 'desde-pdf', action: 'Convertir a Word',
  desc: 'Extrae el texto del PDF a un documento .docx editable.',
  options() {
    const lang = ocrLangSelect();
    return {
      el: [h('div', { class: 'msg warn' }, 'Se extrae el texto línea por línea. No conserva el diseño, las imágenes ni las tablas como en el original. ' +
        'Si el PDF es un escaneo, se usa OCR automáticamente.'),
      field('Idioma del documento (para OCR)', lang)],
      get: () => ({ lang: lang.value }),
    };
  },
  async run({ file, opts, prog }) {
    const pdf = await openPdfJs(file);
    let pages = [];
    let count = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      prog.set(n - 1, pdf.numPages, 'Leyendo página ' + n + ' de ' + pdf.numPages);
      await tick();
      const rows = await extractRows(await pdf.getPage(n));
      count += rows.length;
      pages.push(rows);
    }
    let usedOcr = false;
    if (!count) {
      usedOcr = true; pages = [];
      const worker = await createOcr(opts.lang);
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          prog.set(n - 1, pdf.numPages, 'OCR página ' + n + ' de ' + pdf.numPages + '…');
          const { words } = await ocrPage(worker, pdf, n, false);
          const rows = ocrWordsToRows(words);
          count += rows.length;
          pages.push(rows);
        }
      } finally { await worker.terminate(); }
    }
    if (!count) throw new Error('No se encontró texto en el documento.');
    const para = (cells) => '<w:p>' + cells.map((c, i) =>
      (i ? '<w:r><w:tab/></w:r>' : '') + '<w:r><w:t xml:space="preserve">' + xmlEsc(c.s) + '</w:t></w:r>').join('') + '</w:p>';
    const body = pages.map((rows, i) =>
      (i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + rows.map(para).join('')).join('');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>');
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return { blob, filename: baseName(file) + '.docx', detail: count + ' líneas' + (usedOcr ? ' · leído con OCR' : ''),
      warn: usedOcr ? 'El texto se reconoció con OCR: revisa nombres y números.' : null };
  },
}));

extra.push(pdfTool({
  id: 'pdf-powerpoint', icon: '📽️', title: 'PDF a PowerPoint', cat: 'desde-pdf', action: 'Convertir a PowerPoint',
  desc: 'Cada página del PDF se convierte en una diapositiva.',
  options() {
    return { el: [h('div', { class: 'msg warn' }, 'Cada diapositiva contiene la página como imagen de alta calidad: se ve idéntica, pero el texto no es editable.')], get: () => ({}) };
  },
  async run({ file, prog }) {
    const pdf = await openPdfJs(file);
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const wIn = first.width / 72, hIn = first.height / 72;
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'PDF', width: wIn, height: hIn });
    pptx.layout = 'PDF';
    for (let n = 1; n <= pdf.numPages; n++) {
      prog.set(n - 1, pdf.numPages, 'Página ' + n + ' de ' + pdf.numPages);
      await tick();
      const canvas = await renderCanvas(pdf, n, 2);
      const data = canvas.toDataURL('image/jpeg', 0.88);
      canvas.width = canvas.height = 0;
      pptx.addSlide().addImage({ data, x: 0, y: 0, w: wIn, h: hIn });
    }
    prog.set(1, 1, 'Empaquetando…');
    const blob = await pptx.write({ outputType: 'blob' });
    return { blob, filename: baseName(file) + '.pptx', detail: pdf.numPages + ' diapositivas' };
  },
}));

/* ---------- convertir a PDF ---------- */

extra.push(pdfTool({
  id: 'excel-pdf', icon: '📈', title: 'Excel a PDF', cat: 'a-pdf', action: 'Convertir a PDF',
  desc: 'Convierte una hoja de cálculo (.xlsx, .xls, .csv) a PDF.',
  accept: '.xlsx,.xls,.csv', label: 'Elige el archivo de Excel',
  options() {
    const orient = selectEl([['l', 'Horizontal (recomendado)'], ['p', 'Vertical']], 'l');
    const grid = checkEl('Dibujar líneas de cuadrícula', true);
    return { el: [field('Orientación', orient), grid.el], get: () => ({ orient: orient.value, grid: grid.input.checked }) };
  },
  async run({ file, opts }) {
    const wb = XLSX.read(await readBuf(file), { type: 'array', cellDates: true });
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const bold = await out.embedFont(StandardFonts.HelveticaBold);
    const PW = opts.orient === 'l' ? 841.89 : 595.28, PH = opts.orient === 'l' ? 595.28 : 841.89;
    const M = 30, size = 8, rowH = 14, headH = 22;
    const usable = PW - 2 * M;
    let pageCount = 0;
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      if (!aoa.length) continue;
      const ncols = Math.max(...aoa.map((r) => r.length));
      const widths = Array.from({ length: ncols }, (_, c) => {
        let w = 20;
        for (const r of aoa.slice(0, 300)) {
          const t = safeText(font, String(r[c] ?? ''));
          w = Math.max(w, font.widthOfTextAtSize(t, size) + 8);
        }
        return Math.min(w, usable);
      });
      // Reparte columnas en bloques que caben en el ancho de página.
      const blocks = [];
      let cur = [], acc = 0;
      widths.forEach((w, c) => {
        if (acc + w > usable && cur.length) { blocks.push(cur); cur = []; acc = 0; }
        cur.push(c); acc += w;
      });
      if (cur.length) blocks.push(cur);
      const perPage = Math.floor((PH - 2 * M - headH) / rowH);
      blocks.forEach((cols, bi) => {
        for (let start = 0; start < aoa.length; start += perPage) {
          const page = out.addPage([PW, PH]);
          pageCount++;
          page.drawText(safeText(bold, name) + (blocks.length > 1 ? '  (columnas, parte ' + (bi + 1) + ' de ' + blocks.length + ')' : ''),
            { x: M, y: PH - M + 6, size: 10, font: bold, color: rgb(0.2, 0.2, 0.2) });
          const slice = aoa.slice(start, start + perPage);
          slice.forEach((row, ri) => {
            const y = PH - M - headH - (ri + 1) * rowH + 4;
            let x = M;
            const isHead = start + ri === 0;
            cols.forEach((c) => {
              const w = widths[c];
              if (isHead) page.drawRectangle({ x, y: y - 4, width: w, height: rowH, color: rgb(0.92, 0.93, 0.95) });
              if (opts.grid) page.drawRectangle({ x, y: y - 4, width: w, height: rowH, borderColor: rgb(0.8, 0.8, 0.82), borderWidth: 0.4 });
              let t = safeText(font, String(row[c] ?? ''));
              while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -1);
              if (t) page.drawText(t, { x: x + 3, y, size, font: isHead ? bold : font, color: rgb(0.1, 0.1, 0.1) });
              x += w;
            });
          });
        }
      });
    }
    if (!pageCount) throw new Error('El archivo no contiene datos.');
    return { bytes: await out.save(), filename: baseName(file) + '.pdf', detail: pageCount + ' páginas' };
  },
}));

/* ---------- seguridad ---------- */

extra.push(pdfTool({
  id: 'proteger', icon: '🔐', title: 'Proteger PDF', cat: 'seguridad', action: 'Proteger con contraseña',
  desc: 'Pide una contraseña para abrir el documento.',
  options() {
    const pw = textEl('Contraseña', '', 'password');
    const pw2 = textEl('Repite la contraseña', '', 'password');
    return {
      el: [field('Contraseña', pw), field('Repetir contraseña', pw2),
        h('div', { class: 'msg warn' }, 'Usa cifrado RC4 de 128 bits: evita que lo abra cualquiera, pero no es el cifrado más fuerte (AES-256). ' +
          'Para documentos extremadamente sensibles, protege el archivo con Acrobat o con un gestor de cifrado. No olvides la contraseña: no se puede recuperar.')],
      get: () => ({ pw: pw.value, pw2: pw2.value }),
    };
  },
  async run({ file, opts }) {
    if (!opts.pw) throw new Error('Escribe una contraseña.');
    if (opts.pw !== opts.pw2) throw new Error('Las contraseñas no coinciden.');
    const mod = await import(new URL('vendor/encrypt/index.mjs', location.href).href);
    let bytes;
    try { bytes = await mod.encryptPDF(new Uint8Array(await readBuf(file)), opts.pw); }
    catch (e) {
      if (/already/i.test(e.name + e.message)) throw new Error('Este PDF ya está protegido con contraseña.');
      if (/encod/i.test(e.name + e.message)) throw new Error('La contraseña tiene caracteres no compatibles. Usa letras sin acentos, números y símbolos comunes.');
      throw e;
    }
    return { bytes, filename: baseName(file) + '-protegido.pdf', detail: 'se pedirá la contraseña al abrirlo' };
  },
}));

extra.push(pdfTool({
  id: 'desbloquear', icon: '🔓', title: 'Desbloquear PDF', cat: 'seguridad', action: 'Desbloquear',
  desc: 'Quita la contraseña o las restricciones de un PDF (si conoces la clave o solo tiene restricciones).',
  options() {
    const pw = textEl('Contraseña (si la tiene)', '', 'password');
    const lang = selectEl([['', 'No recuperar texto'], ['spa', 'Recuperar texto con OCR — Español'], ['eng', 'Recuperar texto con OCR — Inglés'], ['spa+eng', 'Recuperar texto con OCR — Español + Inglés']], '');
    return {
      el: [field('Contraseña', pw, 'Déjala vacía si el PDF abre sin contraseña pero no deja copiar o imprimir.'),
        field('Texto seleccionable', lang),
        h('div', { class: 'msg warn' }, 'Solo funciona con documentos tuyos o con permiso. Para no depender de archivos internos, las páginas se guardan como imágenes; ' +
          'activa el OCR si necesitas poder seleccionar y buscar el texto.')],
      get: () => ({ pw: pw.value, lang: lang.value }),
    };
  },
  async run({ file, opts, prog }) {
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await readBuf(file)), password: opts.pw || undefined, isEvalSupported: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error(opts.pw ? 'La contraseña no es correcta.' : 'Este PDF necesita contraseña para abrirse.');
      throw new Error('No se pudo abrir el PDF.');
    }
    const bytes = await rasterPdf(pdf, { scale: 2, q: 0.88, prog, ocr: opts.lang || null, label: 'Procesando' });
    return { bytes, filename: baseName(file) + '-desbloqueado.pdf', detail: pdf.numPages + ' páginas' };
  },
}));

/* ---------- editor sobre la página: firmar, editar, censurar ---------- */

const cap = (el, id) => { try { el.setPointerCapture(id); } catch { /* puntero sintético o ya liberado */ } };
const SCALE = 1.4; // píxeles de pantalla por punto PDF

function trimCanvas(src) {
  const ctx = src.getContext('2d');
  const { width, height } = src;
  const d = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (d[(y * width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 6;
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1 + pad * 2; c.height = y1 - y0 + 1 + pad * 2;
  c.getContext('2d').drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return c;
}

const readDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('No se pudo leer la imagen.'));
  r.readAsDataURL(file);
});

function imageSize(dataUrl) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => rej(new Error('La imagen no es válida.'));
    im.src = dataUrl;
  });
}

/** Panel para crear una firma: dibujarla, escribirla o subir una imagen. */
function signaturePanel(onReady) {
  const pad = h('canvas', { width: 480, height: 170, class: 'sigpad' });
  const ctx = pad.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let drawing = false;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.addEventListener('pointerdown', (e) => { drawing = true; cap(pad, e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); });
  pad.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
  const stop = () => { drawing = false; };
  pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);

  const useCanvas = (c) => {
    const t = trimCanvas(c);
    if (!t) return;
    onReady(t.toDataURL('image/png'), t.width / t.height);
  };
  const typed = textEl('Escribe tu nombre');
  const upload = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
  upload.addEventListener('change', async () => {
    if (!upload.files[0]) return;
    const url = await readDataUrl(upload.files[0]);
    const s = await imageSize(url);
    onReady(url, s.w / s.h);
    upload.value = '';
  });
  return h('div', { class: 'sigpanel' },
    h('div', { class: 'lbl' }, 'Dibuja tu firma'),
    pad,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => useCanvas(pad) }, 'Usar este dibujo'),
      h('button', { class: 'btn ghost small', onclick: () => ctx.clearRect(0, 0, pad.width, pad.height) }, 'Borrar')),
    h('div', { class: 'lbl' }, 'o escribe tu nombre'),
    h('div', { class: 'row' }, typed,
      h('button', { class: 'btn small', onclick: () => {
        if (!typed.value.trim()) return;
        const c = document.createElement('canvas'); c.width = 900; c.height = 200;
        const x = c.getContext('2d');
        x.fillStyle = '#111'; x.font = 'italic 84px "Segoe Script","Brush Script MT","Snell Roundhand",cursive'; x.textBaseline = 'middle';
        x.fillText(typed.value.trim(), 20, 100, 860);
        useCanvas(c);
      } }, 'Usar nombre')),
    h('div', { class: 'lbl' }, 'o sube una imagen de tu firma'),
    upload);
}

/** Editor genérico: muestra una página y permite colocar elementos encima. */
function annotatorTool(def) {
  return {
    id: def.id, icon: def.icon, title: def.title, desc: def.desc, cat: def.cat,
    render(box) {
      let file = null, pdf = null, cur = 1, tool = def.tools[0].id;
      let stamp = null; // { url, aspect }
      let items = [];
      const status = statusArea();
      const prog = progressBar();
      const info = h('div', { class: 'sub' });
      const workspace = h('div', { class: 'ws-pane', hidden: true });
      const stage = h('div', { class: 'stage' });
      const canvasHolder = h('div', { class: 'stage-wrap' }, stage);
      const pageLabel = h('span', { class: 'pg-label' });
      const hint = h('div', { class: 'hint' });
      const textIn = textEl('Texto a añadir', def.defaultText || '');
      const sizeIn = numEl(14, 6, 96);
      const colorIn = selectEl(colorOptions, 'negro');
      const stampInfo = h('span', { class: 'hint' });
      const panelHost = h('div');
      const go = h('button', { class: 'btn go', disabled: true }, def.action);
      const previewHost = h('div', { hidden: true });
      const closePreview = () => {
        const p = previewHost.firstChild;
        if (p && typeof p.close === 'function') p.close();
        previewHost.replaceChildren();
        previewHost.hidden = true;
      };

      const toolButtons = def.tools.map((t) => h('button', { class: 'btn ghost small', 'data-tool': t.id, onclick: () => selectTool(t.id) }, t.label));
      const textControls = h('div', { class: 'row tbx' }, textIn, field('Tamaño', sizeIn), field('Color', colorIn));
      const toolbar = h('div', { class: 'row tb' }, ...toolButtons);

      function selectTool(id) {
        tool = id;
        toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
        const t = def.tools.find((x) => x.id === id);
        textControls.hidden = id !== 'text';
        panelHost.replaceChildren();
        if (id === 'sig') {
          panelHost.append(signaturePanel((url, aspect) => { stamp = { url, aspect, w: 150 }; stampInfo.textContent = 'Firma lista.'; selectTool('stamp-ready'); }));
        } else if (id === 'image') {
          const up = h('input', { type: 'file', accept: 'image/png,image/jpeg' });
          up.addEventListener('change', async () => {
            if (!up.files[0]) return;
            const url = await readDataUrl(up.files[0]); const s = await imageSize(url);
            stamp = { url, aspect: s.w / s.h, w: 150 };
            selectTool('stamp-ready');
          });
          panelHost.append(up);
        }
        if (id === 'stamp-ready') {
          toolButtons.forEach((b) => b.classList.remove('active'));
          hint.textContent = 'Haz clic en la página donde quieres colocarlo. Luego arrástralo para moverlo.';
          return;
        }
        hint.textContent = t ? t.hint : '';
      }

      async function showPage() {
        pageLabel.textContent = 'Página ' + cur + ' de ' + pdf.numPages;
        const canvas = await renderCanvas(pdf, cur, SCALE * (window.devicePixelRatio > 1 ? 1.5 : 1));
        const vw = canvas.width / (SCALE * (window.devicePixelRatio > 1 ? 1.5 : 1));
        const vh = canvas.height / (SCALE * (window.devicePixelRatio > 1 ? 1.5 : 1));
        canvas.style.width = vw * SCALE + 'px'; canvas.style.height = vh * SCALE + 'px';
        stage.style.width = vw * SCALE + 'px'; stage.style.height = vh * SCALE + 'px';
        stage.dataset.vw = vw; stage.dataset.vh = vh;
        const ov = h('div', { class: 'ov' });
        stage.replaceChildren(canvas, ov);
        bindOverlay(ov);
        paintItems(ov);
      }

      function paintItems(ov) {
        ov.querySelectorAll('.it').forEach((n) => n.remove());
        items.filter((it) => it.page === cur).forEach((it) => {
          const el = h('div', { class: 'it it-' + it.t });
          if (it.t === 'text') {
            el.textContent = it.text;
            el.style.fontSize = it.size * SCALE + 'px';
            el.style.color = CSS_COLORS[it.color];
          } else if (it.t === 'img') {
            const im = h('img', { src: it.url, alt: '', draggable: 'false' });
            el.append(im);
          } else {
            el.classList.add('r-' + it.kind);
          }
          place(el, it);
          const x = h('button', { class: 'x', title: 'Quitar', onclick: (e) => { e.stopPropagation(); items = items.filter((i) => i !== it); paintItems(ov); go.disabled = !items.length; } }, '✕');
          el.append(x);
          let drag = null;
          el.addEventListener('pointerdown', (e) => {
            if (e.target === x) return;
            e.stopPropagation();
            drag = { sx: e.clientX, sy: e.clientY, u: it.u, v: it.v };
            cap(el, e.pointerId);
          });
          el.addEventListener('pointermove', (e) => {
            if (!drag) return;
            it.u = drag.u + (e.clientX - drag.sx) / SCALE;
            it.v = drag.v + (e.clientY - drag.sy) / SCALE;
            place(el, it);
          });
          const end = () => { drag = null; };
          el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
          ov.append(el);
        });
      }
      function place(el, it) {
        el.style.left = it.u * SCALE + 'px'; el.style.top = it.v * SCALE + 'px';
        if (it.w) el.style.width = it.w * SCALE + 'px';
        if (it.h) el.style.height = it.h * SCALE + 'px';
      }

      function bindOverlay(ov) {
        const pt = (e) => { const r = ov.getBoundingClientRect(); return { u: (e.clientX - r.left) / SCALE, v: (e.clientY - r.top) / SCALE }; };
        let rect = null, ghost = null;
        ov.addEventListener('pointerdown', (e) => {
          if (e.target !== ov) return;
          const p = pt(e);
          const t = def.tools.find((x) => x.id === tool);
          if (tool === 'text') {
            const text = textIn.value.trim();
            if (!text) { status.error('Escribe primero el texto que quieres añadir.'); return; }
            status.clear();
            items.push({ t: 'text', page: cur, u: p.u, v: p.v, text, size: +sizeIn.value || 14, color: colorIn.value });
            go.disabled = false; paintItems(ov);
          } else if (tool === 'stamp-ready' && stamp) {
            const w = stamp.w, hh = w / stamp.aspect;
            items.push({ t: 'img', page: cur, u: p.u - w / 2, v: p.v - hh / 2, w, h: hh, url: stamp.url });
            go.disabled = false; paintItems(ov);
          } else if (t && t.rect) {
            rect = { u0: p.u, v0: p.v };
            ghost = h('div', { class: 'it r-' + t.rect });
            ov.append(ghost);
            cap(ov, e.pointerId);
          }
        });
        ov.addEventListener('pointermove', (e) => {
          if (!rect) return;
          const p = pt(e);
          const u = Math.min(rect.u0, p.u), v = Math.min(rect.v0, p.v);
          place(ghost, { u, v, w: Math.abs(p.u - rect.u0), h: Math.abs(p.v - rect.v0) });
        });
        const finish = (e) => {
          if (!rect) return;
          const p = pt(e);
          const t = def.tools.find((x) => x.id === tool);
          const it = { t: 'rect', kind: t.rect, page: cur, u: Math.min(rect.u0, p.u), v: Math.min(rect.v0, p.v), w: Math.abs(p.u - rect.u0), h: Math.abs(p.v - rect.v0) };
          rect = null; ghost.remove(); ghost = null;
          if (it.w > 3 && it.h > 3) { items.push(it); go.disabled = false; paintItems(ov); }
        };
        ov.addEventListener('pointerup', finish);
        ov.addEventListener('pointercancel', () => { rect = null; if (ghost) ghost.remove(); ghost = null; });
      }

      const nav = h('div', { class: 'row nav' },
        h('button', { class: 'btn ghost small', onclick: async () => { if (cur > 1) { cur--; await showPage(); } } }, '◀ Anterior'),
        pageLabel,
        h('button', { class: 'btn ghost small', onclick: async () => { if (cur < pdf.numPages) { cur++; await showPage(); } } }, 'Siguiente ▶'));

      workspace.append(toolbar, textControls, panelHost, stampInfo, hint, nav, canvasHolder,
        h('div', { class: 'row' }, go));
      if (def.note) workspace.prepend(h('div', { class: 'msg warn' }, def.note));

      const dz = dropzone({
        accept: '.pdf', label: 'Elige el PDF',
        onFiles: async ([f]) => {
          status.clear();
          closePreview();
          try {
            pdf = await openPdfJs(f);
            file = f; cur = 1; items = []; go.disabled = true;
            info.textContent = f.name + ' — ' + pdf.numPages + ' páginas';
            workspace.hidden = false;
            selectTool(def.tools[0].id);
            await showPage();
          } catch (e) { status.error('No se pudo abrir el PDF: ' + (e.message || e)); }
        },
      });

      go.addEventListener('click', runner(go, status, async () => {
        const r = await def.export({ file, pdf, items, prog });
        prog.hide();
        const filename = baseName(file) + def.suffix;
        if (def.preview) {
          closePreview();
          status.clear();
          const panel = docPreview({ bytes: r.bytes, filename, detail: r.detail,
            onBack: () => { closePreview(); workspace.hidden = false; } });
          previewHost.append(panel);
          previewHost.hidden = false;
          workspace.hidden = true;
        } else {
          status.done({ blob: pdfBlob(r.bytes), filename, detail: r.detail });
        }
      }));

      box.append(dz, info, workspace, previewHost, prog.el, status.el);
      textControls.hidden = true;
    },
  };
}

/** Decodifica un data URL base64 sin usar fetch (la página no tiene permiso de red). */
function dataUrlBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Aplica ítems de texto/imagen/rectángulo sobre un documento de pdf-lib. */
async function applyItems(doc, items) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const imgCache = new Map();
  for (const it of items) {
    const page = pages[it.page - 1];
    if (!page) continue;
    const { W, H, r } = viewDims(page);
    if (it.t === 'rect') {
      const a = viewToUser(r, W, H, it.u, it.v), b = viewToUser(r, W, H, it.u + it.w, it.v + it.h);
      const color = it.kind === 'highlight' ? rgb(1, 0.92, 0.2) : it.kind === 'white' ? rgb(1, 1, 1) : rgb(0, 0, 0);
      page.drawRectangle({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
        color, opacity: it.kind === 'highlight' ? 0.4 : 1, borderWidth: 0 });
    } else if (it.t === 'text') {
      const lines = it.text.split('\n');
      lines.forEach((line, i) => {
        const t = safeText(font, line);
        if (!t) return;
        const { x, y } = viewToUser(r, W, H, it.u, it.v + it.size * 0.94 + i * it.size * 1.2);
        page.drawText(t, { x, y, size: it.size, font, color: COLORS[it.color], rotate: PDFLib.degrees(r) });
      });
    } else if (it.t === 'img') {
      let img = imgCache.get(it.url);
      if (!img) {
        const bytes = dataUrlBytes(it.url);
        img = it.url.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        imgCache.set(it.url, img);
      }
      const { x, y } = viewToUser(r, W, H, it.u, it.v + it.h);
      page.drawImage(img, { x, y, width: it.w, height: it.h, rotate: PDFLib.degrees(r) });
    }
  }
}

/**
 * Vista previa del documento resultante de un annotatorTool (herramienta Editar):
 * renderiza los bytes generados por pdf-lib con pdf.js (todo local, sin red),
 * con paginación cuando hay varias páginas. Ofrece [ Descargar ] o Volver a editar.
 * Devuelve el panel; `panel.close()` libera el documento de pdf.js.
 */
function docPreview({ bytes, filename, detail, onBack }) {
  let doc = null, cur = 1, done = false;
  const blob = pdfBlob(bytes);
  const label = h('span', { class: 'pg-label' });
  const holder = h('div', { class: 'stage-wrap docprev-pages' });
  const prev = h('button', { class: 'btn ghost small', onclick: () => step(-1) }, '◀ Anterior');
  const next = h('button', { class: 'btn ghost small', onclick: () => step(1) }, 'Siguiente ▶');
  const nav = h('div', { class: 'row nav', hidden: true }, prev, label, next);

  async function step(d) {
    const n = cur + d;
    if (!doc || n < 1 || n > doc.numPages) return;
    cur = n;
    await showPage();
  }

  async function showPage() {
    label.textContent = 'Página ' + cur + ' de ' + doc.numPages;
    prev.disabled = cur <= 1;
    next.disabled = cur >= doc.numPages;
    const canvas = await renderCanvas(doc, cur, 1.2);
    if (!done) holder.replaceChildren(canvas);
  }

  const panel = h('div', { class: 'docprev' },
    h('h3', {}, 'Vista previa'),
    h('div', { class: 'sub' }, filename + ' · ' + fmtSize(blob.size) + (detail ? ' · ' + detail : '') +
      ' — así quedó tu PDF editado. Revísalo y descárgalo si está bien.'),
    nav,
    holder,
    h('div', { class: 'row docprev-actions' },
      h('button', { class: 'btn', onclick: () => download(blob, filename) }, '[ Descargar ]'),
      h('button', { class: 'btn ghost', onclick: close }, '↩ Volver a editar')));

  function close() {
    if (done) return;
    done = true;
    if (doc) { const d = doc; doc = null; try { Promise.resolve(d.destroy()).catch(() => {}); } catch { /* ya liberado */ } }
    if (onBack) onBack();
  }

  (async () => {
    try {
      doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      if (done) { const d = doc; doc = null; try { Promise.resolve(d.destroy()).catch(() => {}); } catch { /* ya liberado */ } return; }
      nav.hidden = doc.numPages < 2;
      await showPage();
    } catch (e) {
      holder.replaceChildren(h('div', { class: 'msg err' }, 'No se pudo generar la vista previa: ' + (e && e.message ? e.message : e)));
    }
  })();

  panel.close = close;
  return panel;
}

extra.push(annotatorTool({
  id: 'firmar', icon: '✍️', title: 'Firmar PDF', cat: 'editar', action: 'Guardar PDF firmado', suffix: '-firmado.pdf',
  desc: 'Dibuja o escribe tu firma y colócala en el documento.',
  defaultText: '',
  tools: [
    { id: 'sig', label: '✍️ Crear firma', hint: 'Crea tu firma y luego haz clic en la página para colocarla.' },
    { id: 'text', label: '🔤 Añadir texto (fecha, nombre…)', hint: 'Escribe el texto y haz clic en la página para colocarlo.' },
  ],
  note: 'Esta es una firma visual (imagen). No es una firma digital con certificado.',
  async export({ file, items }) {
    const doc = await openPdfLib(file);
    await applyItems(doc, items);
    return { bytes: await doc.save(), detail: items.length + ' elementos' };
  },
}));

extra.push(annotatorTool({
  id: 'editar', icon: '✏️', title: 'Editar PDF', cat: 'editar', action: 'Vista previa y guardar', suffix: '-editado.pdf',
  preview: true,
  desc: 'Añade texto, imágenes, resaltados o tapa partes del documento.',
  tools: [
    { id: 'text', label: '🔤 Texto', hint: 'Escribe el texto y haz clic en la página para colocarlo.' },
    { id: 'highlight', label: '🖍️ Resaltar', rect: 'highlight', hint: 'Arrastra sobre la página para resaltar un área.' },
    { id: 'white', label: '⬜ Tapar en blanco', rect: 'white', hint: 'Arrastra para cubrir un área con blanco (para corregir algo y escribir encima).' },
    { id: 'image', label: '🖼️ Imagen', hint: 'Elige una imagen y haz clic en la página para colocarla.' },
  ],
  note: 'Esta herramienta añade elementos encima de la página. No cambia el texto original que ya contiene el PDF: tapa lo que quieras corregir y escribe encima.',
  async export({ file, items }) {
    const doc = await openPdfLib(file);
    await applyItems(doc, items);
    return { bytes: await doc.save(), detail: items.length + ' elementos' };
  },
}));

extra.push(annotatorTool({
  id: 'censurar', icon: '⬛', title: 'Censurar PDF', cat: 'seguridad', action: 'Aplicar censura y guardar', suffix: '-censurado.pdf',
  desc: 'Oculta datos sensibles de forma permanente (se elimina el texto, no solo se tapa).',
  tools: [{ id: 'redact', label: '⬛ Censurar área', rect: 'black', hint: 'Arrastra sobre lo que quieres ocultar. Puedes marcar varias áreas y varias páginas.' }],
  note: 'Las páginas con áreas censuradas se convierten en imagen: lo tapado se elimina de verdad y no se puede recuperar, pero el texto de esas páginas deja de ser seleccionable. Las demás páginas no cambian.',
  async export({ file, pdf, items, prog }) {
    const src = await openPdfLib(file);
    const out = await PDFDocument.create();
    const pagesWith = new Set(items.map((i) => i.page));
    const RS = 2.5;
    for (let n = 1; n <= src.getPageCount(); n++) {
      prog.set(n - 1, src.getPageCount(), 'Procesando página ' + n + ' de ' + src.getPageCount());
      await tick();
      if (!pagesWith.has(n)) {
        const [p] = await out.copyPages(src, [n - 1]);
        out.addPage(p);
        continue;
      }
      const canvas = await renderCanvas(pdf, n, RS);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      items.filter((i) => i.page === n).forEach((i) => ctx.fillRect(i.u * RS, i.v * RS, i.w * RS, i.h * RS));
      const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      const w = canvas.width / RS, hh = canvas.height / RS;
      canvas.width = canvas.height = 0;
      const img = await out.embedJpg(await jpg.arrayBuffer());
      out.addPage([w, hh]).drawImage(img, { x: 0, y: 0, width: w, height: hh });
    }
    return { bytes: await out.save(), detail: pagesWith.size + ' páginas censuradas' };
  },
}));

/* ---------- comparar ---------- */

extra.push({
  id: 'comparar', icon: '⚖️', title: 'Comparar PDF', cat: 'optimizar',
  desc: 'Muestra qué texto cambió entre dos versiones de un documento.',
  render(box) {
    const files = { a: null, b: null };
    const status = statusArea();
    const prog = progressBar();
    const go = h('button', { class: 'btn go', disabled: true }, 'Comparar');
    const names = { a: h('div', { class: 'sub' }), b: h('div', { class: 'sub' }) };
    const upd = () => { go.disabled = !(files.a && files.b); };
    const mk = (k, label) => dropzone({
      accept: '.pdf', label,
      onFiles: ([f]) => { files[k] = f; names[k].textContent = f.name; upd(); status.clear(); },
    });
    const lines = async (file) => {
      const pdf = await openPdfJs(file);
      const out = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        prog.set(n - 1, pdf.numPages, 'Leyendo ' + file.name + ' (' + n + '/' + pdf.numPages + ')');
        await tick();
        const rows = await extractRows(await pdf.getPage(n));
        rows.forEach((cells) => { const t = cells.map((c) => c.s).join(' ').trim(); if (t) out.push({ t, p: n }); });
      }
      return out;
    };
    go.addEventListener('click', runner(go, status, async () => {
      const A = await lines(files.a), B = await lines(files.b);
      prog.hide();
      if (!A.length && !B.length) throw new Error('Ninguno de los documentos tiene texto seleccionable. Conviértelos primero con la herramienta de OCR.');
      // recorta prefijo y sufijo comunes y aplica LCS al resto
      let s = 0;
      while (s < A.length && s < B.length && A[s].t === B[s].t) s++;
      let ea = A.length, eb = B.length;
      while (ea > s && eb > s && A[ea - 1].t === B[eb - 1].t) { ea--; eb--; }
      const a = A.slice(s, ea), b = B.slice(s, eb);
      if (a.length * b.length > 6e6) throw new Error('Los documentos difieren demasiado para compararlos aquí (' + a.length + ' × ' + b.length + ' líneas distintas).');
      const m = b.length + 1;
      const dp = new Uint16Array((a.length + 1) * m);
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
        dp[i * m + j] = a[i].t === b[j].t ? dp[(i + 1) * m + j + 1] + 1 : Math.max(dp[(i + 1) * m + j], dp[i * m + j + 1]);
      }
      const diffs = [];
      let i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i].t === b[j].t) { i++; j++; }
        else if (j >= b.length || (i < a.length && dp[(i + 1) * m + j] >= dp[i * m + j + 1])) { diffs.push({ k: '-', ...a[i] }); i++; }
        else { diffs.push({ k: '+', ...b[j] }); j++; }
      }
      const removed = diffs.filter((d) => d.k === '-').length, added = diffs.length - removed;
      const report = diffs.map((d) => (d.k === '-' ? '- [A p.' : '+ [B p.') + d.p + '] ' + d.t).join('\n');
      const list = h('div', { class: 'diff' }, ...diffs.slice(0, 400).map((d) =>
        h('div', { class: 'd' + (d.k === '-' ? 'del' : 'add') }, h('span', { class: 'pgref' }, (d.k === '-' ? 'A' : 'B') + ' · p.' + d.p), d.t)));
      status.clear();
      if (!diffs.length) {
        status.el.append(h('div', { class: 'msg ok' }, 'El texto de ambos documentos es idéntico.'));
        return;
      }
      status.el.append(h('div', { class: 'result' },
        h('h3', {}, 'Diferencias encontradas'),
        h('div', {}, removed + ' líneas solo en A (rojo) · ' + added + ' líneas solo en B (verde)'),
        diffs.length > 400 ? h('div', { class: 'hint' }, 'Se muestran las primeras 400; el informe descargable las incluye todas.') : null,
        list,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => download(new Blob([report], { type: 'text/plain;charset=utf-8' }), 'diferencias.txt') }, 'Descargar informe (.txt)'))));
    }));
    box.append(
      h('div', { class: 'two' },
        h('div', {}, mk('a', 'Documento A (original)'), names.a),
        h('div', {}, mk('b', 'Documento B (nueva versión)'), names.b)),
      h('div', { class: 'row' }, go), prog.el, status.el);
  },
});

/* ---------- registro ---------- */

const CAT_OF = {
  unir: 'organizar', dividir: 'organizar', organizar: 'organizar',
  comprimir: 'optimizar', ocr: 'optimizar',
  'pdf-imagenes': 'desde-pdf', 'pdf-excel': 'desde-pdf',
  'imagenes-pdf': 'a-pdf',
};
tools.forEach((t) => { t.cat = CAT_OF[t.id] || t.cat; });
tools.push(...extra);
