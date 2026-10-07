@echo off
cd /d "%~dp0"
set PYTHONDONTWRITEBYTECODE=1
python app\main.py
if errorlevel 1 (echo. & echo ---- Erro: veja acima ou em data\ludrix.log ---- & pause)
