"""Problemas de optimizacion disponibles para el Algoritmo Genetico.

Incluye funciones benchmark continuas de 2 variables (visualizables como
mapa de calor/contornos) y un problema clasico y muy didactico: hacer
evolucionar una poblacion de cadenas de texto hasta que coincidan con una
cadena objetivo.
"""

from __future__ import annotations

import math
import string
from typing import Any, Literal

import numpy as np

from app.algorithms.genetic.custom_problem import knapsack_problem, tsp_problem
from app.core.base import OptimizationProblem

# --------------------------------------------------------------------------
# Funciones continuas (benchmark), dim = 2 para poder visualizarse como
# superficie/contorno.
# --------------------------------------------------------------------------


class ContinuousFunctionProblem(OptimizationProblem):
    maximize = False
    gene_type: Literal["continuous"] = "continuous"

    def __init__(self, name: str, bounds: list[tuple[float, float]], fn):
        self.name = name
        self._bounds = bounds
        self._fn = fn

    @property
    def dim(self) -> int:
        return len(self._bounds)

    @property
    def bounds(self) -> list[tuple[float, float]]:
        return self._bounds

    def evaluate(self, solution: list[float]) -> float:
        return float(self._fn(solution[0], solution[1]))

    def repair(self, solution: list[float]) -> list[float]:
        repaired = []
        for value, (lo, hi) in zip(solution, self._bounds):
            repaired.append(min(max(value, lo), hi))
        return repaired

    def random_solution(self, rng: np.random.Generator) -> list[float]:
        return [rng.uniform(lo, hi) for (lo, hi) in self._bounds]

    def decode_for_viz(self, solution: list[float]) -> Any:
        return {"x": solution[0], "y": solution[1]}

    def surface_grid(self, resolution: int = 60) -> dict[str, Any] | None:
        (x_lo, x_hi), (y_lo, y_hi) = self._bounds
        xs = np.linspace(x_lo, x_hi, resolution)
        ys = np.linspace(y_lo, y_hi, resolution)
        zz = np.empty((resolution, resolution))
        for j, y in enumerate(ys):
            for i, x in enumerate(xs):
                zz[j, i] = self._fn(x, y)
        return {"x": xs.tolist(), "y": ys.tolist(), "z": zz.tolist()}


def _sphere(x: float, y: float) -> float:
    return x**2 + y**2


def _rastrigin(x: float, y: float) -> float:
    a = 10.0
    return (
        2 * a
        + (x**2 - a * math.cos(2 * math.pi * x))
        + (y**2 - a * math.cos(2 * math.pi * y))
    )


def _ackley(x: float, y: float) -> float:
    return (
        -20 * math.exp(-0.2 * math.sqrt(0.5 * (x**2 + y**2)))
        - math.exp(0.5 * (math.cos(2 * math.pi * x) + math.cos(2 * math.pi * y)))
        + math.e
        + 20
    )


def _himmelblau(x: float, y: float) -> float:
    return (x**2 + y - 11) ** 2 + (x + y**2 - 7) ** 2


def sphere_problem() -> OptimizationProblem:
    return ContinuousFunctionProblem("sphere", [(-5.12, 5.12), (-5.12, 5.12)], _sphere)


def rastrigin_problem() -> OptimizationProblem:
    return ContinuousFunctionProblem("rastrigin", [(-5.12, 5.12), (-5.12, 5.12)], _rastrigin)


def ackley_problem() -> OptimizationProblem:
    return ContinuousFunctionProblem("ackley", [(-5.0, 5.0), (-5.0, 5.0)], _ackley)


def himmelblau_problem() -> OptimizationProblem:
    return ContinuousFunctionProblem("himmelblau", [(-5.0, 5.0), (-5.0, 5.0)], _himmelblau)


# --------------------------------------------------------------------------
# Problema discreto: coincidencia de cadenas de texto (string matching).
# Muy didactico: cada gen es un caracter, la aptitud es el numero de
# caracteres que coinciden con el objetivo.
# --------------------------------------------------------------------------

ALPHABET = string.ascii_letters + string.digits + " .,!?"
_ALPHABET_CODES = [ord(c) for c in ALPHABET]
_CODE_TO_CHAR = {ord(c): c for c in ALPHABET}


class StringMatchProblem(OptimizationProblem):
    name = "string_match"
    maximize = True
    gene_type: Literal["discrete"] = "discrete"

    def __init__(self, target: str = "HELLO WORLD"):
        cleaned = "".join(c if c in ALPHABET else " " for c in target)
        self.target = cleaned
        self._codes = np.array(_ALPHABET_CODES, dtype=float)

    @property
    def dim(self) -> int:
        return len(self.target)

    @property
    def bounds(self) -> list[tuple[float, float]]:
        lo, hi = min(_ALPHABET_CODES), max(_ALPHABET_CODES)
        return [(float(lo), float(hi))] * self.dim

    @property
    def discrete_values(self) -> list[float]:
        return list(self._codes)

    def evaluate(self, solution: list[float]) -> float:
        target_codes = [ord(c) for c in self.target]
        matches = sum(1 for a, b in zip(solution, target_codes) if round(a) == b)
        return float(matches)

    def repair(self, solution: list[float]) -> list[float]:
        repaired = []
        for value in solution:
            idx = int(np.argmin(np.abs(self._codes - value)))
            repaired.append(float(self._codes[idx]))
        return repaired

    def random_solution(self, rng: np.random.Generator) -> list[float]:
        return [float(rng.choice(self._codes)) for _ in range(self.dim)]

    def decode_for_viz(self, solution: list[float]) -> Any:
        return "".join(_CODE_TO_CHAR.get(int(round(v)), "?") for v in solution)

    def surface_grid(self, resolution: int = 60) -> dict[str, Any] | None:
        return None


PROBLEM_FACTORIES = {
    "sphere": sphere_problem,
    "rastrigin": rastrigin_problem,
    "ackley": ackley_problem,
    "himmelblau": himmelblau_problem,
    "string_match": lambda: StringMatchProblem("HELLO WORLD"),
    "tsp": lambda: tsp_problem(n=12, seed=42),
    "knapsack": lambda: knapsack_problem(n=15, seed=7),
}
