"""Modelos pydantic para los cuerpos de peticion/respuesta de la API REST."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CreateRunRequest(BaseModel):
    algorithm_id: str = Field(..., description="Id del algoritmo, p.ej. 'genetic'")
    problem_id: str = Field(..., description="Id del problema, p.ej. 'rastrigin'")
    params: dict[str, Any] = Field(default_factory=dict, description="Parametros del algoritmo")
    speed_ms: float = Field(150.0, ge=0, description="Milisegundos de pausa entre generaciones")


class SpeedRequest(BaseModel):
    speed_ms: float = Field(..., ge=0)
