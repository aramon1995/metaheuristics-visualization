"""Registro de metaheuristicas disponibles.

Cada algoritmo (Genetico, PSO, ACO, ...) se registra aqui con:
- un identificador unico
- el esquema de parametros (pydantic) usado para validar la request y para
  generar automaticamente el formulario en el frontend
- los problemas disponibles para ese algoritmo
- una factory que construye una instancia de `Metaheuristic` lista para
  ejecutarse dado (params, problem_id)

Esto permite anadir nuevas metaheuristicas sin tocar la API ni el frontend:
basta con registrar un nuevo `AlgorithmDescriptor`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from pydantic import BaseModel

from app.core.base import Metaheuristic, OptimizationProblem


@dataclass
class ProblemDescriptor:
    id: str
    name: str
    description: str
    factory: Callable[[], OptimizationProblem]


@dataclass
class AlgorithmDescriptor:
    id: str
    name: str
    description: str
    params_model: type[BaseModel]
    problems: list[ProblemDescriptor]
    factory: Callable[[BaseModel, OptimizationProblem], Metaheuristic]

    def problem_by_id(self, problem_id: str) -> ProblemDescriptor:
        for p in self.problems:
            if p.id == problem_id:
                return p
        raise KeyError(f"Problema '{problem_id}' no existe para el algoritmo '{self.id}'")

    def schema(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "params_schema": self.params_model.model_json_schema(),
            "problems": [
                {"id": p.id, "name": p.name, "description": p.description}
                for p in self.problems
            ],
        }


class AlgorithmRegistry:
    def __init__(self) -> None:
        self._algorithms: dict[str, AlgorithmDescriptor] = {}

    def register(self, descriptor: AlgorithmDescriptor) -> None:
        self._algorithms[descriptor.id] = descriptor

    def get(self, algorithm_id: str) -> AlgorithmDescriptor:
        if algorithm_id not in self._algorithms:
            raise KeyError(f"Algoritmo '{algorithm_id}' no registrado")
        return self._algorithms[algorithm_id]

    def list(self) -> list[AlgorithmDescriptor]:
        return list(self._algorithms.values())


registry = AlgorithmRegistry()
