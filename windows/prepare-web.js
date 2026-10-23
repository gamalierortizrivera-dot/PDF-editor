// Copia la web (raíz del repo) a windows/web para empaquetarla dentro de la app.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'web');
const skip = new Set(['.git', '.github', 'mac', 'windows', 'downloads', 'sw.js', 'README.md', 'LEEME.txt', '.DS_Store']);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(root)) {
  if (skip.has(name) || name.startsWith('PDF-editor') || name.endsWith('.zip')) continue;
  fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
}
fs.copyFileSync(path.join(root, 'icons', 'icon-512.png'), path.join(__dirname, 'icon.png'));
console.log('Web copiada a', out);
