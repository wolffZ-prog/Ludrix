#!/usr/bin/env bash
# Compila os executáveis nativos (stub do launcher, console e monitor de controle) com mingw-w64.
set -e
cd "$(dirname "$0")"
OUT=../../src/main/assets/bin; mkdir -p $OUT
rc() { sed -e "s|ICONFILE|$1|" -e "s|DESCRIPTION|$2|" -e "s|ORIGNAME|$3|" launcher.rc > _tmp.rc; x86_64-w64-mingw32-windres _tmp.rc -O coff -o _tmp.res; rm _tmp.rc; }
rc ../../src/main/assets/icons/icon.ico "LudrixHub" "Ludrix.exe"
x86_64-w64-mingw32-gcc -O2 -s -municode -mwindows -o $OUT/Ludrix.exe launcher.c _tmp.res -lshlwapi -static
rc ../../src/main/assets/icons/console.ico "LudrixHub (modo console)" "LudrixConsole.exe"
x86_64-w64-mingw32-gcc -O2 -s -municode -mwindows -DCONSOLE_MODE=1 -o $OUT/LudrixConsole.exe launcher.c _tmp.res -lshlwapi -static
rc ../../src/main/assets/icons/icon.ico "Monitor de controle do LudrixHub" "ludrix-gamepad.exe"
x86_64-w64-mingw32-gcc -O2 -s -mconsole -o $OUT/ludrix-gamepad.exe gamepad.c _tmp.res -static
rc ../../src/main/assets/icons/icon.ico "Processos do LudrixHub" "ludrix-procs.exe"
x86_64-w64-mingw32-gcc -O2 -s -mconsole -o $OUT/ludrix-procs.exe procs.c _tmp.res -lpsapi -static
rm -f _tmp.res
ls -la $OUT
