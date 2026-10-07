@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Ludrix - GitHub
set "REPO=wolffZ-prog/Ludrix"
set "URL=https://github.com/%REPO%.git"
cd /d "%~dp0"

if not exist "app\version.json" (
  echo Rode este arquivo de dentro da pasta do codigo-fonte do Ludrix ^(onde esta app\ e tools\^).
  pause & exit /b 1
)

where git >nul 2>nul || (
  echo Git nao encontrado. Instale: winget install Git.Git   ^(depois feche e abra o terminal^)
  pause & exit /b 1
)

set "VER="
for /f "usebackq tokens=2 delims=:," %%v in (`findstr /i "\"version\"" app\version.json`) do set "VER=%%~v"
set "VER=%VER:"=%"
set "VER=%VER: =%"
if "%VER%"=="" set "VER=dev"

echo.
echo  Ludrix %VER%  ->  %URL%
echo.

for /f "delims=" %%n in ('git config --global user.name 2^>nul') do set "GNAME=%%n"
if "%GNAME%"=="" (
  set /p GNAME=Seu nome para os commits: 
  git config --global user.name "!GNAME!"
)
for /f "delims=" %%e in ('git config --global user.email 2^>nul') do set "GMAIL=%%e"
if "%GMAIL%"=="" (
  set /p GMAIL=Seu e-mail do GitHub: 
  git config --global user.email "!GMAIL!"
)
git config --global core.autocrlf false >nul
git config --global init.defaultBranch main >nul

set "FIRST=0"
if not exist ".git" (
  set "FIRST=1"
  git init -b main >nul
  echo  [1/5] repositorio criado
) else (
  echo  [1/5] repositorio ja existe
)

git remote get-url origin >nul 2>nul && (git remote set-url origin "%URL%") || (git remote add origin "%URL%")
echo  [2/5] remoto: origin = %URL%

git add -A
git ls-files --cached | findstr /i /r "\.key$ ^chave/ ^data/ ^release/ ^build/ integrity\.json pyc\.json" >nul && (
  echo.
  echo  PARADO: arquivo que nao pode subir foi detectado ^(chave, data, release, build^). Confira o .gitignore.
  git ls-files --cached | findstr /i /r "\.key$ ^chave/ ^data/ ^release/ ^build/ integrity\.json pyc\.json"
  git reset >nul
  pause & exit /b 1
)
echo  [3/5] arquivos conferidos: nenhuma chave ou pasta privada

git diff --cached --quiet && (
  echo  [4/5] nada novo para commitar
) || (
  if "%FIRST%"=="1" (git commit -q -m "Ludrix %VER%") else (git commit -q -m "Ludrix %VER%")
  echo  [4/5] commit: Ludrix %VER%
)

if "%FIRST%"=="1" (
  echo.
  echo  Primeiro envio. O conteudo atual do repositorio no GitHub ^(README vazio^) sera substituido.
  echo  As releases e tags ja publicadas continuam intactas.
  choice /c SN /n /m "  Continuar? [S/N] "
  if errorlevel 2 exit /b 0
  git push -u origin main --force
) else (
  git push -u origin main || (
    echo.
    echo  O GitHub tem commits que voce nao tem aqui. Puxando e tentando de novo...
    git pull --rebase origin main && git push -u origin main
  )
)
if errorlevel 1 (
  echo.
  echo  Falhou ao enviar. Se pediu login: winget install GitHub.cli  e depois  gh auth login
  pause & exit /b 1
)
echo  [5/5] enviado para https://github.com/%REPO%

where gh >nul 2>nul && (
  gh auth status >nul 2>nul && (
    gh repo edit %REPO% --description "LudrixHub - launcher de jogos portatil para Windows: biblioteca, Store por fontes, emuladores, temas e Modo Console" --homepage "https://github.com/%REPO%/releases/latest" --enable-issues --enable-wiki=false >nul 2>nul
    gh repo edit %REPO% --add-topic game-launcher --add-topic windows --add-topic python --add-topic emulation --add-topic webview2 --add-topic portable --add-topic launcher --add-topic games >nul 2>nul
    echo  descricao e topicos do repositorio atualizados
  )
)

echo.
echo  Pronto: https://github.com/%REPO%
echo.
echo  Falta so uma coisa manual ^(uma vez^): Settings -^> General -^> Social preview -^> Upload
echo  e escolha  docs\img\social-preview.png  ^(e a imagem que aparece quando alguem cola o link^).
echo.
echo  Nas proximas versoes: build.bat  ->  publicar.bat  ->  git-setup.bat ^(este^) para subir o codigo.
echo.
pause
