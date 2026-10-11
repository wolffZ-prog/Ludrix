#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(python3 -c "import json;print(json.load(open('$HERE/app/version.json'))['version'])")"
OUT="${OUT:-$HERE/release/$VER}"
WORK="${WORK:-$HERE/build/appimage}"
PY_TAG="${PY_TAG:-cp312-cp312-manylinux2014_x86_64}"
PY_REL="${PY_REL:-python3.12}"
mkdir -p "$WORK" "$OUT"
cd "$WORK"

if [ ! -f python.AppImage ]; then
  url="$(curl -fsSL "https://api.github.com/repos/niess/python-appimage/releases/tags/$PY_REL" | python3 -c "import sys,json;print(next(a['browser_download_url'] for a in json.load(sys.stdin)['assets'] if a['name'].endswith('$PY_TAG.AppImage')))")"
  curl -fL -o python.AppImage "$url"
  chmod +x python.AppImage
fi
rm -rf squashfs-root
./python.AppImage --appimage-extract >/dev/null
AD="$WORK/squashfs-root"
PY="$(ls -d "$AD"/opt/python3.*/bin/python3.* | head -1)"
PYDIR="$(basename "$(dirname "$(dirname "$PY")")")"

grep -v -i 'pyinstaller' "$HERE/requirements.txt" > req-linux.txt
"$PY" -m pip install --no-warn-script-location -U pip >/dev/null
"$PY" -m pip install --no-warn-script-location --resume-retries 30 -r req-linux.txt "pywebview[qt]" python-xlib
"$PY" -m pip install --no-warn-script-location libtorrent || true
"$PY" -m pip cache purge >/dev/null 2>&1 || true

rm -rf "$AD/opt/ludrix"
mkdir -p "$AD/opt/ludrix"
cp -r "$HERE/app" "$AD/opt/ludrix/app"
cp "$HERE/LICENSE" "$AD/opt/ludrix/" 2>/dev/null || true
find "$AD/opt/ludrix" -name '__pycache__' -type d -prune -exec rm -rf {} +
rm -f "$AD/opt/ludrix/app/integrity.json"
find "$AD/opt/$PYDIR/lib" -type d \( -name tests -o -name test -o -name '__pycache__' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$AD/opt/$PYDIR/lib" -path '*PyQt6/Qt6/translations*' -name '*.qm' ! -name 'qtwebengine_locales' -delete 2>/dev/null || true
find "$AD/opt/$PYDIR/lib" -path '*PyQt6/Qt6/qml*' -prune -exec rm -rf {} + 2>/dev/null || true
for m in Qt3D QtBluetooth QtCharts QtDataVisualization QtDesigner QtHelp QtLocation QtMultimedia QtNfc QtPdf QtQuick3D QtRemoteObjects QtSensors QtSerialPort QtSpatialAudio QtSql QtTest QtTextToSpeech QtXml QtQuick QtQml; do
  find "$AD/opt/$PYDIR/lib" -path '*PyQt6*' \( -name "${m}*.so*" -o -name "lib${m}*.so*" -o -name "${m}.abi3.so" \) -delete 2>/dev/null || true
done

FB="$AD/opt/fallback-lib"
rm -rf "$FB"; mkdir -p "$FB"
for lib in libnss3.so libnssutil3.so libsmime3.so libsoftokn3.so libfreeblpriv3.so libnspr4.so libplc4.so libplds4.so libxkbcommon.so.0 libxkbcommon-x11.so.0 libasound.so.2 libXdamage.so.1 libXcomposite.so.1 libxcb-cursor.so.0 libxcb-icccm.so.4 libxcb-keysyms.so.1 libxcb-shape.so.0 libxcb-xkb.so.1 libxcb-render-util.so.0 libxcb-image.so.0 libxcb-util.so.1 libXtst.so.6 libXrandr.so.2 libXcursor.so.1 libXi.so.6 libdouble-conversion.so.3 libpcre2-16.so.0; do
  src="$( (ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null || true) | awk -v l="$lib" '$1==l {print $NF; exit}')"
  [ -n "$src" ] && [ -f "$src" ] && cp -L "$src" "$FB/$lib" || true
done
ls "$FB" | wc -l

rm -f "$AD"/*.desktop "$AD"/*.png "$AD"/.DirIcon "$AD"/AppRun "$AD"/usr/share/applications/*.desktop 2>/dev/null || true
cp "$HERE/app/ui/icon.png" "$AD/ludrix.png"
ln -sf ludrix.png "$AD/.DirIcon"
cat > "$AD/ludrix.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LudrixHub
Comment=Biblioteca e launcher de jogos
Exec=AppRun %U
Icon=ludrix
Terminal=false
Categories=Game;
StartupWMClass=LudrixHub
X-AppImage-Version=$VER
EOF
mkdir -p "$AD/usr/share/applications" "$AD/usr/share/icons/hicolor/256x256/apps"
cp "$AD/ludrix.desktop" "$AD/usr/share/applications/ludrix.desktop"
cp "$AD/ludrix.png" "$AD/usr/share/icons/hicolor/256x256/apps/ludrix.png"

cat > "$AD/AppRun" <<'EOF'
#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"
PYDIR="$(ls -d "$HERE"/opt/python3.* | head -1)"
PYBIN="$(ls "$PYDIR"/bin/python3.* | grep -v config | head -1)"
for v in LD_LIBRARY_PATH LD_PRELOAD PYTHONHOME PYTHONPATH PYTHONNOUSERSITE QT_PLUGIN_PATH QML2_IMPORT_PATH QT_QPA_PLATFORM_PLUGIN_PATH GI_TYPELIB_PATH GSETTINGS_SCHEMA_DIR XDG_DATA_DIRS PATH SSL_CERT_FILE FONTCONFIG_FILE; do
  if [ -z "${!v+x}" ]; then export "LUDRIX_SAVE_$v="; else export "LUDRIX_SAVE_$v=${!v}"; fi
done
export LUDRIX_HOME="${LUDRIX_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/Ludrix}"
mkdir -p "$LUDRIX_HOME"
export PYTHONHOME="$PYDIR"
export PYTHONNOUSERSITE=1
unset PYTHONPATH
export PATH="$PYDIR/bin:$PATH"
export LD_LIBRARY_PATH="$PYDIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ -d "$HERE/opt/fallback-lib" ]; then
  have="$(ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null || true)"
  FBD="${XDG_RUNTIME_DIR:-/tmp}/ludrix-fallback-lib-$$"
  for f in "$HERE"/opt/fallback-lib/*.so*; do
    n="$(basename "$f")"
    if ! printf '%s' "$have" | grep -q "[[:space:]]$n "; then mkdir -p "$FBD" && ln -sf "$f" "$FBD/$n"; fi
  done
  [ -d "$FBD" ] && export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$FBD"
fi
export QTWEBENGINE_DISABLE_SANDBOX=1
export QTWEBENGINE_CHROMIUM_FLAGS="${QTWEBENGINE_CHROMIUM_FLAGS:---disable-gpu-shader-disk-cache --disk-cache-size=67108864}"
export QT_AUTO_SCREEN_SCALE_FACTOR=1
if [ -z "${SSL_CERT_FILE:-}" ]; then
  for c in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/ca-bundle.pem /etc/ssl/cert.pem; do
    [ -f "$c" ] && export SSL_CERT_FILE="$c" && break
  done
fi
export APPIMAGE="${APPIMAGE:-$HERE/AppRun}"
exec "$PYBIN" "$HERE/opt/ludrix/app/main.py" "$@"
EOF
chmod +x "$AD/AppRun"

if [ ! -f appimagetool ]; then
  curl -fL -o appimagetool "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x appimagetool
fi
NAME="LudrixHub-$VER-x86_64.AppImage"
ARCH=x86_64 ./appimagetool --appimage-extract-and-run -n --comp zstd "$AD" "$OUT/$NAME" 2>&1 | grep -v -i 'warning' || true
[ -f "$OUT/$NAME" ] || { echo "falhou: $OUT/$NAME"; exit 1; }
chmod +x "$OUT/$NAME"
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
ls -la "$OUT/$NAME"
