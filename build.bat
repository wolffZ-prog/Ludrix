@echo off
REM ===== Ludrix - compila e empacota. Resultado em release\<versao>\ =====
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
if not exist tools\build.py (
  echo Pasta tools\ nao encontrada. Extraia o zip de codigo-fonte completo e rode de novo.
  pause & exit /b 1
)
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Falhou ao instalar dependencias. Confira a mensagem acima.
  pause & exit /b 1
)
python tools\build.py all %*
pause
