@echo off
setlocal
cd /d "%~dp0"
where dotnet >nul 2>nul || (
  echo .NET SDK 8 nao encontrado. Instale em https://dotnet.microsoft.com/download/dotnet/8.0 ^(SDK, x64^) e rode de novo.
  exit /b 1
)
dotnet publish Ludrix.Host.csproj -c Release -o "..\build\casca" --nologo
if errorlevel 1 exit /b 1
echo.
echo Pronto: build\casca\Ludrix.exe  ^(copie para a pasta onde esta app\ e rode^)
endlocal
