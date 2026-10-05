#!/usr/bin/env bash
# Script de arranque para Linux/macOS.
#
# - Instala `uv` si no esta disponible.
# - Sincroniza las dependencias del proyecto (uv sync).
# - Abre una pestana del navegador apuntando a la app.
# - Lanza el servidor (uvicorn).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST="127.0.0.1"
PORT="8000"
URL="http://${HOST}:${PORT}"

# 1. Asegurar que 'uv' esta instalado
if ! command -v uv >/dev/null 2>&1; then
    echo "uv no encontrado. Instalando uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Instalar/sincronizar dependencias del proyecto (crea el venv si hace falta)
echo "Sincronizando dependencias del proyecto..."
uv sync

# 3. Abrir el navegador en segundo plano en cuanto el servidor responda
(
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "$URL"; then
      break
    fi
    sleep 0.5
  done
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 &
  else
    uv run python -m webbrowser "$URL" >/dev/null 2>&1 &
  fi
) &

# 4. Lanzar el servidor (bloqueante)
echo "Iniciando servidor en ${URL} ..."
exec uv run uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
