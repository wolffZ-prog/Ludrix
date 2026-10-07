@echo off
REM ===== Ludrix - publica a versao atual no GitHub (wolffZ-prog/Ludrix) =====
cd /d "%~dp0"
if not exist tools\build.py ( echo Rode dentro da pasta do codigo-fonte. & pause & exit /b 1 )
python tools\build.py publish %*
pause
