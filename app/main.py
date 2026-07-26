"""Punto de entrada de la aplicacion FastAPI.

Sirve:
- la API REST + WebSocket (bajo /api y /ws)
- una pagina HTML sencilla con CSS y JS para visualizar y controlar el
  entrenamiento de metaheuristicas en tiempo real, y revisarlo despues.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Importar el paquete de algoritmos registra las metaheuristicas disponibles
# (Algoritmo Genetico por ahora; PSO/ACO se anadiran aqui mas adelante).
import app.algorithms  # noqa: F401
from app.api.routes import router, ws_router

BASE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="Visualizador de Metaheuristicas", version="0.1.0")

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

app.include_router(router)
app.include_router(ws_router)


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {})
