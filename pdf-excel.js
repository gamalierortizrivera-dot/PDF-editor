/* PDF Privado — PDF a Excel "copia fiel": tablas, bordes, celdas combinadas, anchos y formato.
 * Lee el texto, las líneas y los rellenos del PDF y los reconstruye en una hoja de Excel (ExcelJS). */
'use strict';

const PDFX_OPS = pdfjsLib.OPS;

/* ---------- 1. Análisis de una página ---------- */

function mapFamily(raw, css) {
  const f = raw.replace(/^[A-Z]{6}\+/, '')
    .replace(/[-,_ ]?(bold|italic|oblique|regular|roman|light|medium|semibold|black|heavy|condensed|narrow|book).*$/i, '')
    .replace(/(PSMT|PS|MT)$/, '');
  if (/times/i.test(f)) return 'Times New Roman';
  if (/courier|mono|consol/i.test(f)) return 'Courier New';
  if (/arial|helvet/i.test(f)) return 'Arial';
  if (f && /^[A-Za-z][A-Za-z0-9 ]{2,}$/.test(f)) return f.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (/serif/i.test(css) && !/sans/i.test(css)) return 'Times New Roman';
  if (/mono/i.test(css)) return 'Courier New';
  return 'Arial';
}

async function analyzePage(page) {
  const vp = page.getViewport({ scale: 1 });
  const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const U = pdfjsLib.Util;

  const fontCache = new Map();
  const fontOf = (name) => {
    if (fontCache.has(name)) return fontCache.get(name);
    let real = '';
    try { if (page.commonObjs.has(name)) real = page.commonObjs.get(name).name || ''; } catch { /* aún no resuelta */ }
    const css = (content.styles[name] || {}).fontFamily || '';
    const o = {
      family: mapFamily(real, css),
      bold: /bold|black|heavy|semibold|demi/i.test(real),
      italic: /italic|oblique/i.test(real),
    };
    fontCache.set(name, o);
    return o;
  };

  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const tr = U.transform(vp.transform, it.transform);
    const size = Math.hypot(tr[2], tr[3]) || it.height || 10;
    items.push({ s: it.str, x: tr[4], y: tr[5], w: it.width, h: size, st: { ...fontOf(it.fontName), size } });
  }

  // Trazados: líneas (bordes de tablas) y rectángulos rellenos (fondos).
  const hl = [], vl = [], fills = [];
  let ctm = vp.transform.slice();
  const stack = [];
  let fill = [0, 0, 0];
  let path = [];
  const P = (x, y) => U.applyTransform([x, y], ctm);
  const addSeg = (a, b) => {
    const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
    if (dy <= 1 && dx > 1) hl.push({ y: (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) });
    else if (dx <= 1 && dy > 1) vl.push({ x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
  };
  const isWhite = (c) => c[0] > 245 && c[1] > 245 && c[2] > 245;
  // Un polígono relleno de lados horizontales y verticales se trata como rectángulo.
  const polygonRects = (shapes) => {
    const out = [];
    let sub = [];
    const flush = () => {
      if (sub.length >= 3 && sub.length <= 5) {
        const axis = sub.every((sg) => Math.abs(sg.a[0] - sg.b[0]) < 0.6 || Math.abs(sg.a[1] - sg.b[1]) < 0.6);
        const pts = sub.flatMap((sg) => [sg.a, sg.b]);
        const first = sub[0].a, last = sub[sub.length - 1].b;
        const closed = Math.abs(first[0] - last[0]) < 0.6 && Math.abs(first[1] - last[1]) < 0.6;
        const closedOrImplicit = closed || sub.length >= 3;
        if (axis && closedOrImplicit) {
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          const x = Math.min(...xs), y = Math.min(...ys);
          out.push({ t: 'rect', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
        }
      }
      sub = [];
    };
    for (const sh of shapes) {
      if (sh.t !== 'seg') continue;
      const prev = sub[sub.length - 1];
      if (prev && (Math.abs(prev.b[0] - sh.a[0]) > 0.6 || Math.abs(prev.b[1] - sh.a[1]) > 0.6)) flush();
      sub.push(sh);
    }
    flush();
    return out;
  };
  const paint = (doFill, doStroke) => {
    if (doFill) {
      const extra = polygonRects(path);
      const strokeOnly = path.filter((sh) => sh.t === 'seg');
      path = path.filter((sh) => sh.t === 'rect').concat(extra);
      if (doStroke) strokeOnly.forEach((sg) => addSeg(sg.a, sg.b));
    }
    for (const sh of path) {
      if (sh.t === 'rect') {
        const { x, y, w, h } = sh;
        if (doFill) {
          if (Math.min(w, h) <= 1.8) {
            if (w >= h) hl.push({ y: y + h / 2, x0: x, x1: x + w }); else vl.push({ x: x + w / 2, y0: y, y1: y + h });
          } else if (w * h > 20 && !isWhite(fill)) fills.push({ x, y, w, h, color: [...fill] });
        }
        if (doStroke) {
          addSeg([x, y], [x + w, y]); addSeg([x, y + h], [x + w, y + h]);
          addSeg([x, y], [x, y + h]); addSeg([x + w, y], [x + w, y + h]);
        }
      } else if (doStroke) addSeg(sh.a, sh.b);
    }
    path = [];
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    switch (fn) {
      case PDFX_OPS.save: stack.push({ ctm: ctm.slice(), fill: [...fill] }); break;
      case PDFX_OPS.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } break; }
      case PDFX_OPS.transform: ctm = U.transform(ctm, args); break;
      case PDFX_OPS.setFillRGBColor: fill = [args[0], args[1], args[2]]; break;
      case PDFX_OPS.constructPath: {
        const [subOps, a] = args;
        let k = 0, cur = null, start = null;
        for (const op of subOps) {
          if (op === PDFX_OPS.moveTo) { cur = P(a[k], a[k + 1]); start = cur; k += 2; }
          else if (op === PDFX_OPS.lineTo) { const n = P(a[k], a[k + 1]); k += 2; if (cur) path.push({ t: 'seg', a: cur, b: n }); cur = n; }
          else if (op === PDFX_OPS.curveTo) { cur = P(a[k + 4], a[k + 5]); k += 6; }
          else if (op === PDFX_OPS.curveTo2 || op === PDFX_OPS.curveTo3) { cur = P(a[k + 2], a[k + 3]); k += 4; }
          else if (op === PDFX_OPS.closePath) { if (cur && start) path.push({ t: 'seg', a: cur, b: start }); cur = start; }
          else if (op === PDFX_OPS.rectangle) {
            const p1 = P(a[k], a[k + 1]), p2 = P(a[k] + a[k + 2], a[k + 1] + a[k + 3]);
            k += 4;
            path.push({ t: 'rect', x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) });
          }
        }
        break;
      }
      case PDFX_OPS.stroke: case PDFX_OPS.closeStroke: paint(false, true); break;
      case PDFX_OPS.fill: case PDFX_OPS.eoFill: paint(true, false); break;
      case PDFX_OPS.fillStroke: case PDFX_OPS.eoFillStroke: case PDFX_OPS.closeFillStroke: case PDFX_OPS.closeEOFillStroke: paint(true, true); break;
      case PDFX_OPS.endPath: case PDFX_OPS.clip: case PDFX_OPS.eoClip: path = []; break;
      default: break;
    }
  }
  return { W: vp.width, H: vp.height, items, hl, vl, fills };
}

/* ---------- 2. Tablas a partir de líneas ---------- */

function cluster1d(vals, tol) {
  const s = [...vals].sort((a, b) => a - b);
  const out = [];
  for (const v of s) {
    if (out.length && v - out[out.length - 1].max <= tol) {
      const g = out[out.length - 1];
      g.sum += v; g.n++; g.max = v;
    } else out.push({ sum: v, n: 1, max: v });
  }
  return out.map((g) => g.sum / g.n);
}

/** Fracción del intervalo [a,b] cubierta por los segmentos [lo,hi]. */
function coverage(intervals, a, b) {
  if (b <= a) return 1;
  const iv = intervals.map(([lo, hi]) => [Math.max(lo, a), Math.min(hi, b)]).filter(([lo, hi]) => hi > lo).sort((p, q) => p[0] - q[0]);
  let covered = 0, end = a;
  for (const [lo, hi] of iv) {
    const s = Math.max(lo, end);
    if (hi > s) { covered += hi - s; end = hi; }
  }
  return covered / (b - a);
}

function detectTables(an) {
  const hs = an.hl.map((s) => ({ ...s })), vs = an.vl.map((s) => ({ ...s }));
  if (hs.length + vs.length > 3500 || !hs.length || !vs.length) return [];
  const T = 2;
  const n = hs.length + vs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    for (let j = 0; j < vs.length; j++) {
      const v = vs[j];
      if (v.x >= h.x0 - T && v.x <= h.x1 + T && h.y >= v.y0 - T && h.y <= v.y1 + T) union(i, hs.length + j);
    }
    for (let k = i + 1; k < hs.length; k++) {
      const o = hs[k];
      if (Math.abs(o.y - h.y) <= 1 && o.x0 <= h.x1 + T && h.x0 <= o.x1 + T) union(i, k);
    }
  }
  for (let j = 0; j < vs.length; j++) {
    for (let k = j + 1; k < vs.length; k++) {
      const a = vs[j], o = vs[k];
      if (Math.abs(o.x - a.x) <= 1 && o.y0 <= a.y1 + T && a.y0 <= o.y1 + T) union(hs.length + j, hs.length + k);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { h: [], v: [] });
    if (i < hs.length) groups.get(r).h.push(hs[i]); else groups.get(r).v.push(vs[i - hs.length]);
  }
  const tables = [];
  for (const g of groups.values()) {
    if (g.h.length < 2 || g.v.length < 2) continue;
    const Xs = cluster1d(g.v.map((v) => v.x), 2);
    const Ys = cluster1d(g.h.map((h) => h.y), 2);
    if (Xs.length < 2 || Ys.length < 2 || (Xs.length - 1) * (Ys.length - 1) < 2) continue;
    if (Xs[Xs.length - 1] - Xs[0] < 20 || Ys[Ys.length - 1] - Ys[0] < 8) continue;
    // Solo cuentan los trazos que pertenecen a esta tabla.
    const vIv = g.v.map((v) => ({ x: v.x, lo: v.y0, hi: v.y1 }));
    const hIv = g.h.map((h) => ({ y: h.y, lo: h.x0, hi: h.x1 }));
    const hasV = (x, y0, y1) => coverage(vIv.filter((v) => Math.abs(v.x - x) <= 2).map((v) => [v.lo, v.hi]), y0, y1) >= 0.6;
    const hasH = (y, x0, x1) => coverage(hIv.filter((h) => Math.abs(h.y - y) <= 2).map((h) => [h.lo, h.hi]), x0, x1) >= 0.6;
    tables.push({ Xs, Ys, hasV, hasH, bbox: [Xs[0], Ys[0], Xs[Xs.length - 1], Ys[Ys.length - 1]] });
  }
  return tables;
}

/** Calcula las celdas (con combinaciones) de una tabla y le asigna el texto. */
function fillTable(t, items, fills) {
  const R = t.Ys.length - 1, C = t.Xs.length - 1;
  const used = Array.from({ length: R }, () => Array(C).fill(false));
  const spans = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (used[r][c]) continue;
      let c2 = c;
      while (c2 + 1 < C && !t.hasV(t.Xs[c2 + 1], t.Ys[r], t.Ys[r + 1])) c2++;
      let r2 = r;
      for (;;) {
        if (r2 + 1 >= R) break;
        let open = true;
        for (let cc = c; cc <= c2; cc++) if (used[r2 + 1][cc] || t.hasH(t.Ys[r2 + 1], t.Xs[cc], t.Xs[cc + 1])) { open = false; break; }
        if (!open) break;
        r2++;
      }
      for (let rr = r; rr <= r2; rr++) for (let cc = c; cc <= c2; cc++) used[rr][cc] = true;
      spans.push({ r0: r, r1: r2, c0: c, c1: c2, items: [] });
    }
  }
  const spanAt = new Map();
  spans.forEach((s, i) => { for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) spanAt.set(r * C + c, i); });
  const idxIn = (arr, v) => {
    for (let i = 0; i < arr.length - 1; i++) if (v >= arr[i] - 1 && v < arr[i + 1] + 0.01) return i;
    return -1;
  };
  const rest = [];
  for (const it of items) {
    const cx = it.x + it.w / 2, cy = it.y - it.h * 0.3;
    const [x0, y0, x1, y1] = t.bbox;
    if (cx < x0 - 1 || cx > x1 + 1 || cy < y0 - 1 || cy > y1 + 1) { rest.push(it); continue; }
    const c = idxIn(t.Xs, cx), r = idxIn(t.Ys, cy);
    if (c < 0 || r < 0) { rest.push(it); continue; }
    spans[spanAt.get(r * C + c)].items.push(it);
  }
  const finalSpans = [];
  for (const s of spans) {
    const x0 = t.Xs[s.c0], x1 = t.Xs[s.c1 + 1], y0 = t.Ys[s.r0], y1 = t.Ys[s.r1 + 1];
    const lines = groupRows(s.items);
    s.lines = lines;
    s.text = lines.map((l) => l.cells.map((c) => c.s).join(' ')).join('\n');
    s.st = lines.length ? lines[0].cells[0].st : null;
    s.box = { x0, x1, y0, y1 };
    s.border = {
      l: t.hasV(x0, y0, y1), r: t.hasV(x1, y0, y1), t: t.hasH(y0, x0, x1), b: t.hasH(y1, x0, x1),
    };
    // alineación horizontal según dónde cae el texto dentro de la celda
    if (s.items.length) {
      const l = Math.min(...s.items.map((i) => i.x)), r = Math.max(...s.items.map((i) => i.x + i.w));
      const w = x1 - x0, gapL = l - x0, gapR = x1 - r;
      s.align = Math.abs(gapL - gapR) < Math.max(3, w * 0.08) && gapL > 6 ? 'center' : gapR < 6 && gapL > 14 ? 'right' : 'left';
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const f = fills.filter((q) => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (f) s.fill = f.color;

    // Una celda combinada con varios bloques de texto separados se reparte en celdas individuales.
    if (s.c1 > s.c0 && lines.some((l) => l.cells.length >= 2)) {
      const byCol = new Map();
      lines.forEach((l) => l.cells.forEach((cell) => {
        let c = s.c0;
        for (let k = s.c0; k <= s.c1; k++) if (cell.x >= t.Xs[k] - 1) c = k;
        if (!byCol.has(c)) byCol.set(c, []);
        byCol.get(c).push(cell);
      }));
      for (let c = s.c0; c <= s.c1; c++) {
        const cells = byCol.get(c) || [];
        const text = cells.map((q) => q.s).join('\n');
        const border = { l: c === s.c0 && s.border.l, r: c === s.c1 && s.border.r, t: s.border.t, b: s.border.b };
        if (!text && !s.fill && !border.l && !border.r && !border.t && !border.b) continue;
        finalSpans.push({ ...s, c0: c, c1: c, text, st: cells[0] ? cells[0].st : s.st, align: 'left', border });
      }
    } else finalSpans.push(s);
  }
  t.spans = finalSpans;
  return rest;
}

/* ---------- 3. Texto suelto → filas ---------- */

/** Agrupa fragmentos (y hacia abajo) en filas y celdas, conservando el estilo. */
function groupRows(items) {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, it.h * 0.5)) { last.items.push(it); last.h = Math.max(last.h, it.h); }
    else rows.push({ y: it.y, h: it.h, items: [it] });
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
          cur.h = Math.max(cur.h, it.h);
          if (it.st && it.st.bold && cur.st && !cur.st.bold && it.s.trim().length > cur.s.length / 2) cur.st = it.st;
          continue;
        }
        cells.push(cur);
      }
      cur = { s: it.s, x: it.x, w: it.w, h: it.h, st: it.st };
    }
    if (cur) cells.push(cur);
    return { y: r.y, h: r.h, cells: cells.map((c) => ({ ...c, s: c.s.replace(/\s+/g, ' ').trim() })).filter((c) => c.s) };
  }).filter((r) => r.cells.length);
}

/* ---------- 4. Valores numéricos ---------- */

function typedValue(s, mode) {
  if (mode === 'texto') return { v: s };
  let t = s.trim();
  let cur = '';
  const m0 = t.match(/^([$€£])\s*/);
  if (m0) { cur = m0[1]; t = t.slice(m0[0].length); }
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1).trim(); }
  let pct = false;
  if (t.endsWith('%')) { pct = true; t = t.slice(0, -1).trim(); }
  const us = mode === 'us';
  const re = us ? /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/ : /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
  if (!re.test(t) || /^0\d/.test(t)) return { v: s };
  const thousands = us ? t.includes(',') : t.includes('.');
  const dec = (us ? t.split('.')[1] : t.split(',')[1]) || '';
  const num = parseFloat(us ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(num)) return { v: s };
  let v = neg ? -num : num;
  if (pct) v /= 100;
  let fmt = (thousands ? '#,##0' : '0') + (dec ? '.' + '0'.repeat(dec.length) : '');
  if (pct) fmt += '%';
  if (cur) fmt = '"' + cur + '"' + fmt;
  return { v, fmt };
}

/* ---------- 5. Ensamblado de una hoja ---------- */

const pxToChars = (pt) => Math.min(120, Math.max(0.9, (pt * 4 / 3 - 5) / 7));
const argb = (c) => 'FF' + c.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('').toUpperCase();
const luminance = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

function buildSheet(ws, pages, cfg) {
  // Columnas: posiciones de inicio del texto y bordes verticales de tablas.
  const xs = [];
  let hasTables = false;
  pages.forEach((p) => {
    p.rows.forEach((r) => r.cells.forEach((c) => xs.push(c.x)));
    p.tables.forEach((t) => { hasTables = true; t.Xs.forEach((x) => xs.push(x)); });
  });
  if (!xs.length) return { rows: 0, preview: [], tables: 0 };
  let tol = hasTables ? Math.min(cfg.tol, 4) : cfg.tol;
  let B = clusterColumns(xs, tol);
  while (B.length > 160) { tol *= 1.5; B = clusterColumns(xs, tol); }
  const colOf = (x) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < B.length; i++) { const d = Math.abs(B[i] - x); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  let maxRight = B[B.length - 1] + 40;
  pages.forEach((p) => {
    p.rows.forEach((r) => r.cells.forEach((c) => { maxRight = Math.max(maxRight, c.x + c.w); }));
    p.tables.forEach((t) => { maxRight = Math.max(maxRight, t.bbox[2]); });
  });

  // Filas: texto suelto + filas de tablas, ordenadas de arriba abajo.
  const sheetRows = []; // { height, cells: Map(col -> cell), tableRowRefs }
  const preview = [];
  let tableCount = 0;
  const rowOfSlot = new Map();
  const pending = []; // trabajos de combinación entre filas

  pages.forEach((p, pi) => {
    if (pi > 0 && cfg.stack) {
      sheetRows.push({ height: 22, cells: new Map(), sep: 'Página ' + p.no });
    }
    const slots = [];
    p.rows.forEach((r) => slots.push({ kind: 'free', top: r.y - r.h * 0.85, bottom: r.y + r.h * 0.25, cells: r.cells, maxH: r.h }));
    p.tables.forEach((t, ti) => {
      tableCount++;
      for (let r = 0; r < t.Ys.length - 1; r++) slots.push({ kind: 'table', t, ti, r, top: t.Ys[r], bottom: t.Ys[r + 1], maxH: 10 });
    });
    slots.sort((a, b) => a.top - b.top);
    const finals = [];
    for (const s of slots) {
      const last = finals[finals.length - 1];
      if (last) {
        const overlap = Math.min(last.bottom, s.bottom) - s.top;
        const minH = Math.min(last.bottom - last.top, s.bottom - s.top);
        if (overlap > 0.5 * minH) {
          last.slots.push(s);
          last.bottom = Math.max(last.bottom, s.bottom);
          last.top = Math.min(last.top, s.top);
          last.maxH = Math.max(last.maxH, s.maxH);
          continue;
        }
      }
      finals.push({ top: s.top, bottom: s.bottom, maxH: s.maxH, slots: [s] });
    }
    finals.forEach((f, i) => {
      const content = f.bottom - f.top;
      const nextGap = finals[i + 1] ? finals[i + 1].top - f.top : content;
      const hasTable = f.slots.some((sl) => sl.kind === 'table');
      let height = hasTable ? content : Math.max(content, Math.min(nextGap, content * 3 + 6));
      height = Math.min(Math.max(height, 12, f.maxH * 1.3), 300);
      const row = { height, cells: new Map() };
      sheetRows.push(row);
      f.slots.forEach((s) => {
        if (s.kind !== 'table') return;
        if (!rowOfSlot.has(s.t)) rowOfSlot.set(s.t, {});
        rowOfSlot.get(s.t)[s.r] = sheetRows.length;
      });
      f.slots.forEach((s) => {
        if (s.kind === 'free') {
          s.cells.forEach((c) => {
            const col = colOf(c.x);
            const prev = row.cells.get(col);
            if (prev) { prev.text += (prev.text.includes('\n') || c.x < prev.x + 1 ? ' ' : '\n') + c.s; return; }
            row.cells.set(col, { col, col2: col, row2: sheetRows.length, text: c.s, st: c.st, x: c.x, fill: findFill(p, c) });
          });
        }
      });
    });
    // celdas de tabla: ahora que las filas existen
    p.tables.forEach((t) => {
      const map = rowOfSlot.get(t) || {};
      t.spans.forEach((sp) => {
        const r0 = map[sp.r0], r1 = map[sp.r1];
        if (!r0) return;
        const c0 = colOf(t.Xs[sp.c0]);
        let c1 = colOf(t.Xs[sp.c1 + 1]) - 1;
        if (c1 < c0) c1 = c0;
        const row = sheetRows[r0 - 1];
        const key = c0;
        const prev = row.cells.get(key);
        const cell = { col: c0, col2: c1, row2: r1 || r0, text: sp.text, st: sp.st, table: true, align: sp.align, border: sp.border, fill: sp.fill, multi: sp.text.includes('\n'), x: t.Xs[sp.c0] };
        if (prev) { cell.text = cell.text ? cell.text : prev.text; if (prev.text && sp.text) cell.text = prev.text + '\n' + sp.text; }
        row.cells.set(key, cell);
      });
    });
  });

  // Escritura en ExcelJS
  const ncols = B.length;
  for (let c = 0; c < ncols; c++) {
    const w = c < ncols - 1 ? B[c + 1] - B[c] : Math.max(30, maxRight - B[c]);
    ws.getColumn(c + 1).width = pxToChars(w);
  }
  const occupied = new Set();
  sheetRows.forEach((row, ri) => {
    const r = ri + 1;
    const wsRow = ws.getRow(r);
    wsRow.height = row.height;
    const pv = [];
    if (row.sep) {
      const cell = ws.getCell(r, 1);
      cell.value = '— ' + row.sep + ' —';
      cell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF888888' } };
      preview[ri] = [cell.value];
      return;
    }
    for (const cell of row.cells.values()) {
      if (occupied.has(r + ':' + cell.col)) continue;
      const c = cell.col + 1;
      const target = ws.getCell(r, c);
      const multi = cell.multi || cell.text.includes('\n');
      const tv = multi ? { v: cell.text } : typedValue(cell.text, cfg.numbers);
      target.value = tv.v;
      if (tv.fmt) target.numFmt = tv.fmt;
      pv[cell.col] = cell.text;
      if (cfg.styles) {
        const st = cell.st || {};
        const dark = cell.fill && luminance(cell.fill) < 0.4;
        target.font = {
          name: st.family || 'Arial', size: Math.max(6, Math.min(40, Math.round((st.size || 10) * 2) / 2)),
          bold: !!st.bold, italic: !!st.italic, color: { argb: dark ? 'FFFFFFFF' : 'FF000000' },
        };
        const isNum = typeof tv.v === 'number';
        target.alignment = {
          horizontal: cell.table ? (isNum ? 'right' : cell.align || 'left') : 'left',
          vertical: cell.table ? 'middle' : 'top',
          wrapText: !!cell.table || multi,
        };
        if (cell.fill) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(cell.fill) } };
      }
      const spanR = (cell.row2 || r) > r, spanC = cell.col2 > cell.col;
      if (spanR || spanC) {
        const r2 = Math.min(cell.row2 || r, sheetRows.length);
        let free = true;
        for (let rr = r; rr <= r2 && free; rr++) for (let cc = cell.col; cc <= cell.col2; cc++) if (occupied.has(rr + ':' + cc)) { free = false; break; }
        if (free) {
          try { ws.mergeCells(r, c, r2, cell.col2 + 1); } catch { /* combinación solapada: se deja sin combinar */ }
          for (let rr = r; rr <= r2; rr++) for (let cc = cell.col; cc <= cell.col2; cc++) occupied.add(rr + ':' + cc);
        }
      }
      if (cfg.styles && cell.border) {
        const r2 = Math.min(cell.row2 || r, sheetRows.length);
        const side = (on) => (on ? { style: 'thin', color: { argb: 'FF4D4D4D' } } : undefined);
        for (let rr = r; rr <= r2; rr++) for (let cc = c; cc <= cell.col2 + 1; cc++) {
          const b = {};
          const left = side(cell.border.l && cc === c), right = side(cell.border.r && cc === cell.col2 + 1);
          const top = side(cell.border.t && rr === r), bottom = side(cell.border.b && rr === r2);
          if (left) b.left = left; if (right) b.right = right; if (top) b.top = top; if (bottom) b.bottom = bottom;
          if (Object.keys(b).length) ws.getCell(rr, cc).border = b;
          if (cell.fill && (rr !== r || cc !== c)) ws.getCell(rr, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(cell.fill) } };
        }
      }
    }
    preview[ri] = pv;
  });
  return { rows: sheetRows.length, preview, tables: tableCount };
}

function findFill(page, c) {
  if (!page.fills || c.y === undefined) return null;
  const cx = c.x + c.w / 2, cy = c.y - c.h * 0.3;
  const f = page.fills.filter((q) => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
  return f ? f.color : null;
}

/* ---------- 6. Herramienta ---------- */

const pdfExcelTool = {
  id: 'pdf-excel', icon: '📊', title: 'PDF a Excel', cat: 'desde-pdf',
  desc: 'Convierte el PDF en una hoja de Excel que se ve como el original: tablas, bordes y formato.',
  render(box) {
    let file = null;
    const status = statusArea();
    const prog = progressBar();
    const info = h('div', { class: 'sub' });
    const sel = (opts, def) => h('select', {}, ...opts.map(([v, t]) => h('option', { value: v, selected: v === def }, t)));
    const modeSwitch = checkEl('Detectar tablas y conservar el formato del PDF', true);
    const mode = { get value() { return modeSwitch.input.checked ? 'fiel' : 'simple'; } };
    const sheets = sel([['varias', 'Una hoja por página (como el PDF)'], ['una', 'Todo en una sola hoja']], 'varias');
    const cols = sel([['normal', 'Normal'], ['estricta', 'Estricta (más columnas)'], ['flexible', 'Flexible (menos columnas)']], 'normal');
    const nums = sel([['us', '1,234.56 (coma para miles)'], ['eu', '1.234,56 (punto para miles)'], ['texto', 'Dejar todo como texto']], 'us');
    const ocrMode = sel([['auto', 'Automático (solo si el PDF no tiene texto)'], ['si', 'Siempre (PDF escaneado)'], ['no', 'Nunca']], 'auto');
    const ocrLang = ocrLangSelect();
    const go = h('button', { class: 'btn go', disabled: true }, 'Convertir a Excel');
    const opts = h('div', { class: 'opts', hidden: true },
      h('div', {}, modeSwitch.el,
        h('span', { class: 'hint' }, 'Reconstruye tablas con bordes, celdas combinadas, anchos de columna, negritas y colores de fondo. Apágalo para obtener solo filas y columnas.')),
      h('label', {}, h('span', { class: 'lbl' }, 'Hojas'), sheets),
      h('label', {}, h('span', { class: 'lbl' }, 'Formato de números'), nums),
      h('label', {}, h('span', { class: 'lbl' }, 'Detección de columnas'), cols,
        h('span', { class: 'hint' }, 'Si ves columnas partidas, prueba "Flexible". Si se juntan datos, prueba "Estricta".')),
      h('label', {}, h('span', { class: 'lbl' }, 'Reconocimiento de texto (OCR)'), ocrMode,
        h('span', { class: 'hint' }, 'Para PDF escaneados o fotos. Es más lento: unos segundos por página.')),
      h('label', {}, h('span', { class: 'lbl' }, 'Idioma del documento (OCR)'), ocrLang));
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF con la tabla',
      onFiles: ([f]) => { file = f; info.textContent = f.name + ' — ' + fmtSize(f.size); opts.hidden = false; go.disabled = false; status.clear(); },
    });

    go.addEventListener('click', runner(go, status, async () => {
      const fiel = mode.value === 'fiel';
      const tol = { estricta: 4, normal: 8, flexible: 16 }[cols.value];
      const pdf = await openPdfJs(file);
      const analyses = [];
      let textItems = 0;
      let usedOcr = false;

      if (ocrMode.value !== 'si') {
        for (let n = 1; n <= pdf.numPages; n++) {
          prog.set(n - 1, pdf.numPages, 'Analizando página ' + n + ' de ' + pdf.numPages);
          await tick();
          const an = await analyzePage(await pdf.getPage(n));
          textItems += an.items.length;
          analyses.push(an);
        }
      }
      if (ocrMode.value === 'si' || (!textItems && ocrMode.value === 'auto')) {
        usedOcr = true;
        analyses.length = 0;
        textItems = 0;
        prog.set(0, pdf.numPages, 'Preparando OCR…');
        const worker = await createOcr(ocrLang.value);
        try {
          for (let n = 1; n <= pdf.numPages; n++) {
            prog.set(n - 1, pdf.numPages, 'OCR página ' + n + ' de ' + pdf.numPages + '…');
            const vp = (await pdf.getPage(n)).getViewport({ scale: 1 });
            const { words } = await ocrPage(worker, pdf, n, false);
            const items = words.map((w) => {
              const hh = (w.y1 - w.y0) * 0.85;
              return { s: w.s, x: w.x0, y: w.y1 - (w.y1 - w.y0) * 0.2, w: w.x1 - w.x0, h: hh,
                st: { family: 'Arial', bold: false, italic: false, size: hh * 0.9 } };
            });
            textItems += items.length;
            analyses.push({ W: vp.width, H: vp.height, items, hl: [], vl: [], fills: [] });
          }
        } finally { await worker.terminate(); }
      }
      prog.set(1, 1, 'Construyendo el Excel…');
      await tick();
      if (!textItems) {
        throw new Error(ocrMode.value === 'no'
          ? 'Este PDF no contiene texto seleccionable (parece un escaneo). Activa el reconocimiento de texto (OCR) y vuelve a intentarlo.'
          : 'No se pudo reconocer texto en este documento. Revisa que el idioma elegido sea el correcto y que la imagen sea legible.');
      }

      // Estructura de cada página
      const layouts = analyses.map((an, i) => {
        let free = an.items;
        let tables = [];
        if (fiel) {
          tables = detectTables(an);
          // las más pequeñas primero, para que cada texto caiga en la tabla más específica
          tables.sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]));
          for (const t of tables) free = fillTable(t, free, an.fills);
          tables = tables.filter((t) => t.spans.some((s) => s.text));
        }
        const rows = groupRows(free).map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, y: r.y })) }));
        return { no: i + 1, rows, tables, fills: fiel ? an.fills : [], W: an.W, H: an.H };
      });

      const wb = new ExcelJS.Workbook();
      wb.creator = 'PDF Privado';
      const cfg = { tol, numbers: nums.value, styles: fiel, stack: sheets.value === 'una' };
      let totalRows = 0, totalTables = 0, preview = [];
      if (sheets.value === 'una') {
        const ws = wb.addWorksheet('Datos', { views: [{ showGridLines: !fiel }] });
        const r = buildSheet(ws, layouts, cfg);
        totalRows = r.rows; totalTables = r.tables; preview = r.preview;
      } else {
        layouts.forEach((p, i) => {
          const ws = wb.addWorksheet('Página ' + (i + 1), { views: [{ showGridLines: !fiel }] });
          const r = buildSheet(ws, [p], cfg);
          totalRows += r.rows; totalTables += r.tables;
          if (!i) preview = r.preview;
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      prog.hide();

      status.done({
        blob, filename: baseName(file) + '.xlsx',
        detail: totalRows + ' filas' + (fiel ? ' · ' + totalTables + ' tablas detectadas' : '') + (usedOcr ? ' · leído con OCR' : ''),
        extra: h('div', {},
          usedOcr ? h('div', { class: 'msg warn' }, 'El texto se reconoció con OCR: revisa números y nombres, pueden contener errores de lectura.') : null,
          h('div', { class: 'hint' }, 'El archivo conserva bordes, formato y anchos; la vista previa solo muestra los valores.')),
      });
    }));
    box.append(dz, info, opts, h('div', { class: 'row' }, go), prog.el, status.el);
  },
};

(() => {
  const i = tools.findIndex((t) => t.id === 'pdf-excel');
  if (i >= 0) tools[i] = pdfExcelTool; else tools.push(pdfExcelTool);
})();
