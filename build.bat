@echo off
REM ===== LudrixHub - monta a pasta pronta em release\<versao>\Ludrix =====
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instalando pelo winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Feche esta janela e rode o build.bat de novo.
  pause ^& exit /b 1
)
if not exist node_modules\electron\dist\electron.exe (
  echo Baixando dependencias ^(so na primeira vez^)...
  call npm ci --no-audit --no-fund
  if errorlevel 1 ( echo Falhou ao instalar dependencias. & pause & exit /b 1 )
)
if "%~1"=="" ( node tools\build.js folder ) else ( node tools\build.js %* )
if errorlevel 1 ( echo. & echo Build falhou. Veja a mensagem acima. & pause & exit /b 1 )
echo.
echo Pronto. A pasta esta em release\ ^(abra Ludrix.exe dentro dela^).
start "" explorer release
pause
