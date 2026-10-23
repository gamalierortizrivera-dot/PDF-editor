# PDF-editor
Editor de PDF

## Herramientas
**Organizar:** Unir, Dividir, Organizar y Eliminar Páginas (ordenar/girar/eliminar), Girar.
**Optimizar:** Comprimir, OCR (PDF escaneado a PDF buscable), Reparar, Comparar.
**Convertir a PDF:** Imágenes a PDF, Excel a PDF.
**Convertir desde PDF:** PDF a imágenes, PDF a Excel (copia fiel: tablas con bordes, celdas combinadas, anchos, formato y OCR), PDF a Word, PDF a PowerPoint.
**Editar y firmar:** Crear código QR (texto/URL, Wi-Fi, contacto, email, teléfono, SMS; PNG/SVG o dentro de un PDF), Numerar páginas, Marca de agua, Recortar, Firmar, Editar (texto, imágenes, resaltado).
**Seguridad:** Proteger con contraseña, Desbloquear, Censurar (elimina el contenido), Metadatos.



## Estructura del proyecto
```
index.html            Página y orden de scripts (política CSP sin red)
css/tokens.css        Variables de diseño: colores, radios, sombras, tipografía
css/base.css          Reset, cabecera, estructura de página
css/components.css    Insignia, búsqueda, pestañas, tarjetas, botones, dropzone, pasos, paneles
css/tools.css         Piezas internas de herramientas (editor de página, firma, comparación…)
ui/icons.js           Iconos vectoriales y logo (SVG)
ui/shell.js           Catálogo, búsqueda, pestañas y espacio de trabajo en 3 pasos
app.js                Utilidades comunes y herramientas básicas (unir, dividir, OCR…)
tools-extra.js        Herramientas adicionales (firmar, editar, proteger…)
pdf-excel.js          Conversor PDF a Excel de copia fiel
vendor/               Librerías locales (sin CDN)
```
Para añadir una herramienta: registra un objeto `{ id, icon, title, desc, render(box) }` en `tools` y
agrega su entrada (categoría, descripción corta, palabras clave) en `TOOL_UI` de `ui/shell.js`.

## App nativa de macOS (.dmg)
`mac/build.sh` construye `downloads/PDF-Privado-macOS.dmg` (universal: Apple Silicon + Intel) con las
herramientas de línea de comandos de Xcode. La app es un envoltorio WKWebView que sirve la web desde su
propio paquete (esquema `app://`); no abre conexiones de red. Está firmada ad hoc: para distribuirla sin
avisos de Gatekeeper hace falta firma y notarización con una cuenta de Apple Developer.
Autoprueba: `PDFPRIVADO_SELFTEST=1 "mac/build/PDF Privado.app/Contents/MacOS/PDFPrivado"`.

## App de escritorio para Windows (.exe)
`windows/` contiene un envoltorio Electron equivalente al de macOS: sirve la web desde su propio paquete
(esquema `app://`), bloquea toda conexión de red y usa el diálogo «Guardar como» de Windows para las descargas.
- Probar en local: `cd windows && npm install && npm start` (autoprueba: `npm run selftest`).
- Instalador: `npm run dist` genera `windows/dist/PDF-Privado-Windows-Setup.exe` (NSIS, x64). Hay que ejecutarlo en
  Windows; el flujo `.github/workflows/windows.yml` lo construye en GitHub Actions y lo sube como artefacto.
- Para que el botón de descarga de la web funcione, copia el `.exe` a `downloads/PDF-Privado-Windows-Setup.exe`.
- Sin firmar: Windows SmartScreen avisará hasta que se firme con un certificado de firma de código.
