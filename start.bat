@echo off
REM Script de arranque para Windows.
REM Doble click: instala dependencias si faltan, abre una pestana del
REM navegador y lanza el servidor.

setlocal

set "HOST=127.0.0.1"
set "PORT=8000"
set "URL=http://%HOST%:%PORT%"

cd /d "%~dp0"

REM 1. Asegurar que 'uv' esta instalado
where uv >nul 2>nul
if errorlevel 1 (
    echo uv no encontrado. Instalando uv...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

where uv >nul 2>nul
if errorlevel 1 (
    echo No se pudo instalar/encontrar 'uv'. Instala Python y uv manualmente.
    pause
    exit /b 1
)

REM 2. Instalar/sincronizar dependencias del proyecto
echo Sincronizando dependencias del proyecto...
uv sync
if errorlevel 1 (
    echo Error al sincronizar dependencias.
    pause
    exit /b 1
)

REM 3. Abrir el navegador en cuanto el servidor responda (en segundo plano)
start "" /min powershell -NoProfile -Command ^
    "for ($i=0; $i -lt 30; $i++) { try { Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 1 | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }"

REM 4. Lanzar el servidor (bloqueante; deja la ventana abierta)
echo Iniciando servidor en %URL% ...
uv run uvicorn app.main:app --host %HOST% --port %PORT% --reload

pause
