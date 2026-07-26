"""Abstracciones base compartidas por todas las metaheuristicas.

Estas clases definen el "contrato" que debe cumplir cualquier metaheuristica
(Algoritmo Genetico, PSO, ACO, ...) para poder ser ejecutada y visualizada
por la aplicacion, sin que la API ni el frontend necesiten conocer detalles
especificos de cada algoritmo.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Iterator, Literal

import numpy as np


@dataclass
class IterationState:
    """Snapshot del estado de la metaheuristica tras una iteracion.

    Es la unidad minima de informacion que se transmite al frontend (via
    WebSocket en vivo, o via history para el replay).
    """

    iteration: int
    best_fitness: float
    avg_fitness: float
    worst_fitness: float
    best_solution: list[float]
    population: list[list[float]]
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "iteration": self.iteration,
            "best_fitness": self.best_fitness,
            "avg_fitness": self.avg_fitness,
            "worst_fitness": self.worst_fitness,
            "best_solution": self.best_solution,
            "population": self.population,
            "extra": self.extra,
        }


class OptimizationProblem(ABC):
    """Define el problema a resolver: como se evalua una solucion y como
    se visualiza (dimension, limites, si es maximizacion o minimizacion).
    """

    name: str = "problem"
    maximize: bool = True
    gene_type: Literal["continuous", "discrete"] = "continuous"

    @property
    @abstractmethod
    def dim(self) -> int:
        """Numero de variables/genes de una solucion."""

    @property
    @abstractmethod
    def bounds(self) -> list[tuple[float, float]]:
        """Limites [min, max] por variable, usados para inicializar y para
        dibujar la superficie de fitness (cuando dim <= 2)."""

    @abstractmethod
    def evaluate(self, solution: list[float]) -> float:
        """Calcula el fitness (mayor es mejor si maximize=True)."""

    def decode_for_viz(self, solution: list[float]) -> Any:
        """Representacion adicional de la solucion para mostrar en la UI
        (por ejemplo, decodificar genes a un string). Por defecto no-op."""
        return solution

    def repair(self, solution: list[float]) -> list[float]:
        """Ajusta una solucion para que respete el espacio valido (recortar
        a los limites, o al valor discreto valido mas cercano). Por defecto
        recorta cada gen a `bounds`."""
        return [min(max(v, lo), hi) for v, (lo, hi) in zip(solution, self.bounds)]

    def random_solution(self, rng: np.random.Generator) -> list[float]:
        """Genera una solucion aleatoria valida. Por defecto, uniforme
        dentro de `bounds`."""
        return [rng.uniform(lo, hi) for (lo, hi) in self.bounds]

    def surface_grid(self, resolution: int = 60) -> dict[str, Any] | None:
        """Devuelve una malla (grid) de valores de fitness para dibujar un
        mapa de calor/contornos de fondo. Solo aplica si dim == 2."""
        return None


class Metaheuristic(ABC):
    """Interfaz que debe implementar cualquier metaheuristica ejecutable."""

    algorithm_id: str = "base"

    @abstractmethod
    def run(self) -> Iterator[IterationState]:
        """Generador que produce un IterationState por cada iteracion."""
