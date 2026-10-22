/* PDF Privado — Crear código QR. Se carga después de tools-extra.js (reutiliza sus ayudas).
 * El QR se genera en el navegador con vendor/qrcode.min.js; nada sale del equipo. */
'use strict';

const QR_TYPES = [
  ['texto', 'Texto o enlace (URL)'], ['wifi', 'Red Wi-Fi'], ['contacto', 'Contacto (vCard)'],
  ['email', 'Correo electrónico'], ['telefono', 'Teléfono'], ['sms', 'Mensaje SMS'],
];
const QR_ECC = [['L', 'Bajo (7 %)'], ['M', 'Medio (15 %)'], ['Q', 'Alto (25 %)'], ['H', 'Muy alto (30 %)']];
const QR_POS = [
  ['tl', 'Arriba a la izquierda'], ['tc', 'Arriba al centro'], ['tr', 'Arriba a la derecha'],
  ['ml', 'Centro a la izquierda'], ['mc', 'Centro'], ['mr', 'Centro a la derecha'],
  ['bl', 'Abajo a la izquierda'], ['bc', 'Abajo al centro'], ['br', 'Abajo a la derecha'],
];

/** Texto → matriz de módulos oscuros (array de filas de booleanos). */
function qrMatrix(text, ecc) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, ecc);
  q.addData(text, 'Byte');
  try { q.make(); } catch { throw new Error('El contenido es demasiado largo para un código QR con ese nivel de corrección. Acórtalo o baja el nivel.'); }
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

function qrSvg(m, size, quiet, fg, bg) {
  const n = m.length, t = n + quiet * 2;
  let d = '';
  m.forEach((row, y) => {
    for (let x = 0; x < n;) {
      if (!row[x]) { x++; continue; }
      let e = x;
      while (e < n && row[e]) e++;
      d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h' + (e - x) + 'v1h-' + (e - x) + 'z';
      x = e;
    }
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + ' ' + t
    + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges"><rect width="' + t + '" height="' + t
    + '" fill="' + bg + '"/><path fill="' + fg + '" d="' + d + '"/></svg>\n';
}

function qrDraw(canvas, m, size, quiet, fg, bg) {
  const n = m.length, t = n + quiet * 2, s = size / t;
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  g.fillStyle = fg;
  m.forEach((row, y) => row.forEach((on, x) => {
    if (!on) return;
    const l = Math.round((x + quiet) * s), r = Math.round((x + quiet + 1) * s);
    const tp = Math.round((y + quiet) * s), b = Math.round((y + quiet + 1) * s);
    g.fillRect(l, tp, r - l, b - tp);
  }));
}

const lum = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};

const wifiEsc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
const vcEsc = (s) => s.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');

tools.push({
  id: 'qr', icon: '▦', title: 'Crear código QR',
  desc: 'Genera códigos QR, descárgalos o ponlos dentro de un PDF.',
  render(box) {
    const status = statusArea();
    const msg = h('div');
    let pdfFile = null;

    /* --- contenido según el tipo --- */
    const type = selectEl(QR_TYPES, 'texto');
    const inp = (ph, extra) => { const e = textEl(ph); if (extra) Object.entries(extra).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
    const f = {
      texto: h('textarea', { rows: '4', placeholder: 'https://ejemplo.com o cualquier texto', class: 'qr-area' }),
      ssid: inp('Nombre de la red'), pass: inp('Contraseña'), sec: selectEl([['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'Sin contraseña']], 'WPA'),
      hidden: checkEl('Red oculta', false),
      nombre: inp('Nombre'), apellido: inp('Apellidos'), org: inp('Empresa'), tel: inp('+52 55 1234 5678', { inputmode: 'tel' }),
      mail: inp('correo@ejemplo.com', { inputmode: 'email', autocapitalize: 'off' }), web: inp('https://ejemplo.com', { autocapitalize: 'off' }),
      eTo: inp('destino@ejemplo.com', { inputmode: 'email', autocapitalize: 'off' }), eSub: inp('Asunto'),
      eBody: h('textarea', { rows: '3', placeholder: 'Mensaje', class: 'qr-area' }),
      tTel: inp('+52 55 1234 5678', { inputmode: 'tel' }),
      sTel: inp('+52 55 1234 5678', { inputmode: 'tel' }), sMsg: h('textarea', { rows: '3', placeholder: 'Mensaje', class: 'qr-area' }),
    };
    const forms = {
      texto: [field('Contenido', f.texto, 'Un enlace, un texto, lo que quieras.')],
      wifi: [field('Red (SSID)', f.ssid), field('Seguridad', f.sec), field('Contraseña', f.pass), f.hidden.el],
      contacto: [field('Nombre', f.nombre), field('Apellidos', f.apellido), field('Empresa', f.org), field('Teléfono', f.tel),
        field('Correo', f.mail), field('Sitio web', f.web)],
      email: [field('Para', f.eTo), field('Asunto', f.eSub), field('Mensaje', f.eBody)],
      telefono: [field('Número de teléfono', f.tTel)],
      sms: [field('Número', f.sTel), field('Mensaje', f.sMsg)],
    };
    const typeBox = h('div', { class: 'opts' });
    const content = () => {
      const g = (el) => el.value.trim();
      switch (type.value) {
        case 'wifi':
          if (!g(f.ssid)) return '';
          return 'WIFI:T:' + f.sec.value + ';S:' + wifiEsc(g(f.ssid)) + ';' + (f.sec.value === 'nopass' ? '' : 'P:' + wifiEsc(f.pass.value) + ';')
            + (f.hidden.input.checked ? 'H:true;' : '') + ';';
        case 'contacto': {
          if (![f.nombre, f.apellido, f.org, f.tel, f.mail, f.web].some((e) => g(e))) return '';
          const l = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + vcEsc(g(f.apellido)) + ';' + vcEsc(g(f.nombre)) + ';;;',
            'FN:' + vcEsc((g(f.nombre) + ' ' + g(f.apellido)).trim())];
          if (g(f.org)) l.push('ORG:' + vcEsc(g(f.org)));
          if (g(f.tel)) l.push('TEL:' + g(f.tel));
          if (g(f.mail)) l.push('EMAIL:' + g(f.mail));
          if (g(f.web)) l.push('URL:' + g(f.web));
          l.push('END:VCARD');
          return l.join('\n');
        }
        case 'email': {
          if (!g(f.eTo)) return '';
          const q = [];
          if (g(f.eSub)) q.push('subject=' + encodeURIComponent(g(f.eSub)));
          if (g(f.eBody)) q.push('body=' + encodeURIComponent(g(f.eBody)));
          return 'mailto:' + g(f.eTo) + (q.length ? '?' + q.join('&') : '');
        }
        case 'telefono': return g(f.tTel) ? 'tel:' + g(f.tTel).replace(/[\s()-]/g, '') : '';
        case 'sms': return g(f.sTel) ? 'SMSTO:' + g(f.sTel).replace(/[\s()-]/g, '') + ':' + g(f.sMsg) : '';
        default: return f.texto.value.trim();
      }
    };

    /* --- apariencia --- */
    const size = numEl(512, 128, 2048, 32);
    const quiet = numEl(4, 0, 10, 1);
    const ecc = selectEl(QR_ECC, 'M');
    const fg = h('input', { type: 'color', value: '#000000', class: 'qr-color' });
    const bg = h('input', { type: 'color', value: '#ffffff', class: 'qr-color' });
    const look = h('div', { class: 'opts' },
      field('Tamaño (píxeles)', size, 'Para PNG y SVG: entre 128 y 2048.'),
      field('Corrección de errores', ecc, 'Más alto = se lee aunque esté dañado, pero el QR es más denso.'),
      h('div', { class: 'qr-colors' }, field('Color del código', fg), field('Color del fondo', bg)),
      field('Margen (módulos)', quiet, 'El margen blanco ayuda a que se escanee. Recomendado: 4.'));

    /* --- vista previa en vivo --- */
    const canvas = h('canvas', { class: 'qr-canvas', width: '300', height: '300' });
    const prevNote = h('div', { class: 'hint' }, 'Escribe el contenido para ver el código.');
    const dlPng = h('button', { class: 'btn', disabled: true }, '[ Descargar PNG ]');
    const dlSvg = h('button', { class: 'btn ghost', disabled: true }, '[ Descargar SVG ]');
    let cur = null; // { m, size, quiet, fg, bg }

    const update = () => {
      msg.replaceChildren();
      const text = content();
      cur = null;
      if (!text) {
        canvas.hidden = true; prevNote.hidden = false; dlPng.disabled = dlSvg.disabled = true; return;
      }
      try {
        const sz = Math.min(2048, Math.max(128, Math.round(Number(size.value)) || 512));
        const qz = Math.min(10, Math.max(0, Math.round(Number(quiet.value))));
        const m = qrMatrix(text, ecc.value);
        cur = { m, size: sz, quiet: Number.isNaN(qz) ? 4 : qz, fg: fg.value, bg: bg.value };
        qrDraw(canvas, m, 600, cur.quiet, cur.fg, cur.bg);
        canvas.hidden = false; prevNote.hidden = true; dlPng.disabled = dlSvg.disabled = false;
        if (lum(cur.fg) >= lum(cur.bg)) {
          msg.append(h('div', { class: 'msg warn' }, 'El código es más claro que el fondo: algunos lectores no lo reconocen. Usa un código oscuro sobre fondo claro.'));
        } else if (Math.abs(lum(cur.fg) - lum(cur.bg)) < 0.4) {
          msg.append(h('div', { class: 'msg warn' }, 'Hay poco contraste entre el código y el fondo; puede costar escanearlo.'));
        }
      } catch (e) {
        canvas.hidden = true; prevNote.hidden = true; dlPng.disabled = dlSvg.disabled = true;
        msg.append(h('div', { class: 'msg err' }, e.message));
      }
    };

    const paintType = () => { typeBox.replaceChildren(...forms[type.value]); update(); };
    type.addEventListener('change', paintType);
    box.addEventListener('input', update);
    box.addEventListener('change', update);

    dlPng.addEventListener('click', async () => {
      if (!cur) return;
      const c = document.createElement('canvas');
      qrDraw(c, cur.m, cur.size, cur.quiet, cur.fg, cur.bg);
      download(await canvasToBlob(c, 'image/png'), 'codigo-qr.png');
    });
    dlSvg.addEventListener('click', () => {
      if (!cur) return;
      download(new Blob([qrSvg(cur.m, cur.size, cur.quiet, cur.fg, cur.bg)], { type: 'image/svg+xml' }), 'codigo-qr.svg');
    });

    /* --- insertar en un PDF --- */
    const pageNo = numEl(1, 1, 9999, 1);
    const allPages = checkEl('En todas las páginas', false);
    const pos = selectEl(QR_POS, 'br');
    const qrSize = numEl(100, 20, 600, 5);
    const margin = numEl(24, 0, 200, 4);
    const pdfInfo = h('div', { class: 'sub' });
    const pdfOpts = h('div', { class: 'opts', hidden: true },
      field('Página', pageNo, 'Número de página donde va el código.'), allPages.el,
      field('Posición', pos), field('Tamaño del QR (puntos)', qrSize, '72 puntos = 2,54 cm. Con 100 mide unos 3,5 cm.'),
      field('Distancia al borde (puntos)', margin));
    const go = h('button', { class: 'btn go', disabled: true }, 'Insertar QR en el PDF');
    const prog = progressBar();
    const dz = dropzone({
      accept: '.pdf', label: 'Elige el PDF donde insertar el QR',
      onFiles: async ([file]) => {
        status.clear();
        try {
          const doc = await openPdfLib(file);
          pdfFile = file;
          const n = doc.getPageCount();
          pageNo.max = String(n); pageNo.value = '1';
          pdfInfo.textContent = file.name + ' — ' + fmtSize(file.size) + ' · ' + n + (n === 1 ? ' página' : ' páginas');
          pdfOpts.hidden = false; go.disabled = false;
        } catch (e) { status.error(e.message); }
      },
    });

    go.addEventListener('click', runner(go, status, async () => {
      if (!cur) throw new Error('Primero escribe el contenido del código QR.');
      const doc = await openPdfLib(pdfFile);
      const n = doc.getPageCount();
      const pn = Math.round(Number(pageNo.value));
      if (!allPages.input.checked && !(pn >= 1 && pn <= n)) throw new Error('Elige una página entre 1 y ' + n + '.');
      const s = Math.min(600, Math.max(20, Number(qrSize.value) || 100));
      const mg = Math.max(0, Number(margin.value) || 0);
      const c = document.createElement('canvas');
      qrDraw(c, cur.m, Math.max(cur.size, 600), cur.quiet, cur.fg, cur.bg);
      const img = await doc.embedPng(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
      const targets = allPages.input.checked ? doc.getPages() : [doc.getPage(pn - 1)];
      for (const page of targets) {
        const { W, H, r, vw, vh } = viewDims(page);
        const p = pos.value;
        const u = p[1] === 'l' ? mg : p[1] === 'r' ? vw - mg - s : (vw - s) / 2;
        const v = p[0] === 't' ? mg : p[0] === 'b' ? vh - mg - s : (vh - s) / 2;
        const o = viewToUser(r, W, H, u, v + s); // esquina inferior izquierda del QR, vista en pantalla
        page.drawImage(img, { x: o.x, y: o.y, width: s, height: s, rotate: PDFLib.degrees(r) });
      }
      status.done({ bytes: await doc.save(), filename: baseName(pdfFile) + '-con-qr.pdf',
        detail: targets.length + (targets.length === 1 ? ' página' : ' páginas') });
    }));
    const pdfPane = h('div', {}, dz, pdfInfo, pdfOpts, h('div', { class: 'row' }, go), prog.el);

    paintType();
    box.append(h('div', { class: 'qr ws-pane' },
      h('div', { class: 'qr-prev' }, canvas, prevNote, h('div', { class: 'row' }, dlPng, dlSvg), msg),
      h('div', { class: 'qr-form' },
        h('div', { class: 'opts' }, field('Tipo de contenido', type)), typeBox, look,
        h('h3', { class: 'qr-h' }, 'Insertar en un PDF (opcional)'), pdfPane, status.el)));
  },
});
