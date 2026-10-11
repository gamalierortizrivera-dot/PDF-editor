# PDF-editor
Editor de PDF


## PDF Privado

Herramientas PDF al estilo iLovePDF que corren 100% en el navegador.
No hay servidor, ni subida de archivos, ni almacenamiento (la página tiene una
política CSP con `connect-src 'none'`, así que ni siquiera puede hacer peticiones de red).

## Usar
- Local: `python3 -m http.server 8000` dentro de esta carpeta y abrir http://localhost:8000
- Equipo/empresa: subir la carpeta completa a cualquier servidor web estático interno (HTTPS).

## Herramientas
Unir, Dividir, Organizar páginas (ordenar/girar/eliminar), Comprimir, PDF a imágenes,
Imágenes a PDF, PDF a Excel, OCR (PDF escaneado a PDF buscable y a Excel).

## Límites conocidos
- El OCR es local (Tesseract, español e inglés) y puede cometer errores en escaneos de baja calidad.
- Comprimir rasteriza las páginas: el texto deja de ser seleccionable.
- No abre PDF protegidos con contraseña.

## Librerías (en `vendor/`, sin CDN)
pdf-lib 1.17.1, pdf.js 3.11.174, SheetJS 0.18.5, JSZip 3.10.1, Tesseract.js 5.1.1 (+ datos de idioma spa/eng).
