// Conffetti PDF — envoltorio nativo para Windows (Electron).
// Sirve la web incluida en el paquete mediante un esquema local (app://) y bloquea toda conexión de red.
'use strict';
const { app, BrowserWindow, Menu, protocol, session, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, 'web');
const selfTest = process.argv.includes('--selftest') || !!process.env.CONFFETTIPDF_SELFTEST;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function serveWeb() {
  protocol.handle('app', (request) => {
    let pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const target = path.normalize(path.join(WEB, pathname));
    if (target !== WEB && !target.startsWith(WEB + path.sep)) {
      return new Response('No encontrado', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString()).catch(() => new Response('No encontrado', { status: 404 }));
  });
}

function lockDownSession(ses) {
  // Sin red: solo la propia app, blob: y data:.
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(app|blob|data|devtools|chrome-extension):/i.test(details.url) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 760, minHeight: 520,
    title: 'Conffetti PDF',
    backgroundColor: '#0F172A',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);

  // Nada de ventanas nuevas ni navegación fuera de la app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });

  // Descargas generadas por la página (blob:): Electron muestra el diálogo "Guardar como".
  win.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Guardar archivo', defaultPath: item.getFilename() });
  });

  win.loadURL('app://local/index.html');
  if (selfTest) win.webContents.once('did-finish-load', runSelfTest);
  win.on('closed', () => { win = null; });
}

async function runSelfTest() {
  const code = `(async () => {
    await new Promise(r => setTimeout(r, 800));
    const out = { cards: document.querySelectorAll('.card').length, ua: navigator.userAgent.includes('ConffettiPDFWin') };
    try { await fetch('https://example.com', { mode: 'no-cors' }); out.network = 'ABIERTA'; } catch (e) { out.network = 'bloqueada'; }
    return JSON.stringify(out);
  })()`;
  try {
    console.log('SELFTEST ' + await win.webContents.executeJavaScript(code));
    app.exit(0);
  } catch (e) {
    console.log('SELFTEST ERROR ' + e);
    app.exit(1);
  }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Edición', submenu: [
      { role: 'undo', label: 'Deshacer' }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
    ] },
    { label: 'Ver', submenu: [
      { role: 'resetZoom', label: 'Tamaño real' }, { role: 'zoomIn', label: 'Acercar' },
      { role: 'zoomOut', label: 'Alejar' }, { role: 'togglefullscreen', label: 'Pantalla completa' },
    ] },
  ]));
}

app.whenReady().then(() => {
  app.userAgentFallback += ' ConffettiPDFWin/1.0';
  serveWeb();
  lockDownSession(session.defaultSession);
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
