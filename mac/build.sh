#!/bin/bash
# Construye "Conffetti PDF.app" (universal: Apple Silicon + Intel) y el instalador .dmg.
# Requiere macOS con las herramientas de línea de comandos de Xcode (swiftc, hdiutil, codesign).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/mac/build"
APP="$OUT/Conffetti PDF.app"
DMG_DIR="$ROOT/downloads"
rm -rf "$OUT" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$DMG_DIR"

echo "→ Compilando…"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos12.0" mac/main.swift -o "$OUT/ConffettiPDF-$arch"
done
lipo -create "$OUT/ConffettiPDF-arm64" "$OUT/ConffettiPDF-x86_64" -output "$APP/Contents/MacOS/ConffettiPDF"
cp mac/Info.plist "$APP/Contents/Info.plist"

echo "→ Copiando la web…"
rsync -a --exclude '.git' --exclude 'mac' --exclude 'downloads' --exclude 'PDF-editor*' --exclude '*.zip' \
  --exclude '.DS_Store' --exclude 'sw.js' --exclude 'README.md' ./ "$APP/Contents/Resources/web/"

echo "→ Icono…"
ICONSET="$OUT/AppIcon.iconset"; mkdir -p "$ICONSET"
SRC="icons/icon-512.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "→ Firmando (ad hoc)…"
codesign --force --deep --sign - "$APP"

echo "→ Creando .dmg…"
STAGE="$OUT/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG_DIR/Conffetti-PDF-macOS.dmg"
hdiutil create -volname "Conffetti PDF" -srcfolder "$STAGE" -ov -format UDZO "$DMG_DIR/Conffetti-PDF-macOS.dmg" >/dev/null
echo "Listo: $DMG_DIR/Conffetti-PDF-macOS.dmg"
