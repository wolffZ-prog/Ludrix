@echo off
REM ===== Ludrix - lanca a versao atual: build + release no GitHub + codigo no GitHub =====
setlocal
cd /d "%~dp0"
if not exist tools\build.py ( echo Rode dentro da pasta do codigo-fonte. & pause & exit /b 1 )
for /f "delims=" %%v in ('python tools\build.py version') do set "VER=%%v"
echo.
echo  Lancar Ludrix %VER%
echo   1. build.bat      (compila e empacota)
echo   2. publicar.bat   (release v%VER% no GitHub com zip, patch e feed)
echo   3. git-setup.bat  (codigo no GitHub)
echo.
choice /c SN /n /m "  Continuar? [S/N] "
if errorlevel 2 exit /b 0
echo.
echo ===== [1/3] build =====
python tools\build.py all
if errorlevel 1 ( echo. & echo  Build falhou. Nada foi publicado. & pause & exit /b 1 )
echo.
echo ===== [2/3] release no GitHub =====
python tools\build.py publish
if errorlevel 1 ( echo. & echo  Publicacao falhou. O codigo NAO foi enviado. & pause & exit /b 1 )
echo.
echo ===== [3/3] codigo no GitHub =====
call git-setup.bat
