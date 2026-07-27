"""Problemas definidos por el usuario mediante una expresion de coste en el
pseudolenguaje seguro (`app.core.safe_eval`), en lugar de codigo Python
arbitrario.

`CustomExpressionProblem` es el problema generico: soporta 3 tipos de
genoma (continuo, binario, permutacion) y evalua la aptitud ejecutando una
expresion validada por `app.core.safe_eval` con las variables del genoma
mas variables auxiliares fijas (matriz de distancias, pesos, valores,
capacidad, etc.) provistas por quien define el problema.

Sobre esa base generica se construyen dos ejemplos didacticos clasicos:
- Viajante de comercio (TSP): genoma de permutacion, distancia euclidiana.
- Mochila 0-1 (Knapsack): genoma binario, con penalizacion por exceder la
  capacidad expresada directamente en la formula de coste.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np

from app.core.base import OptimizationProblem
from app.core.safe_eval import (
    ExpressionEvaluationError,
    UnsafeExpressionError,
    evaluate_expression,
    validate_and_compile,
)

CustomGeneKind = Literal["continuous", "binary", "permutation"]


class CustomProblemError(ValueError):
    """Error al definir o evaluar un problema personalizado (expresion
    invalida/insegura, configuracion incoherente, etc.). Se distingue de
    `UnsafeExpressionError`/`ExpressionEvaluationError` (que son mas
    especificas) para que la API pueda reportar un mensaje unico y claro."""


class CustomExpressionProblem(OptimizationProblem):
    """Problema generico: la aptitud es el resultado de evaluar `expression`
    (pseudolenguaje seguro) sobre el genoma del individuo mas variables
    auxiliares fijas.

    El genoma se expone a la expresion bajo el nombre `genome_var_name`
    (por defecto `"x"` para continuo/binario, `"tour"` para permutacion),
    ademas de `n` (dimension) y cualquier variable extra en `variables`.
    """

    def __init__(
        self,
        name: str,
        kind: CustomGeneKind,
        n: int,
        expression: str,
        maximize: bool = True,
        variables: dict[str, Any] | None = None,
        bounds: list[tuple[float, float]] | tuple[float, float] | None = None,
        genome_var_name: str | None = None,
        decode: Literal["raw", "selected_indices", "tour"] | None = None,
    ):
        if n < 1:
            raise CustomProblemError("La dimension 'n' debe ser >= 1")
        self.name = name
        self.maximize = maximize
        self._kind = kind
        self._n = n
        self._extra_variables = dict(variables or {})
        self._genome_var_name = genome_var_name or ("tour" if kind == "permutation" else "x")
        self._decode = decode or ("tour" if kind == "permutation" else ("selected_indices" if kind == "binary" else "raw"))

        if kind == "continuous":
            self.gene_type = "continuous"
            if bounds is None:
                self._bounds = [(-10.0, 10.0)] * n
            elif isinstance(bounds, tuple):
                self._bounds = [bounds] * n
            else:
                if len(bounds) != n:
                    raise CustomProblemError("'bounds' debe tener exactamente 'n' elementos")
                self._bounds = [tuple(b) for b in bounds]
        elif kind == "binary":
            self.gene_type = "discrete"
            self._bounds = [(0.0, 1.0)] * n
        elif kind == "permutation":
            self.gene_type = "permutation"
            self._bounds = [(0.0, float(n - 1))] * n
        else:
            raise CustomProblemError(f"Tipo de genoma no soportado: {kind!r}")

        # Se valida y parsea la expresion una sola vez, al crear el
        # problema (fail-fast: un error de sintaxis o una construccion no
        # permitida se reporta inmediatamente, antes de arrancar el run).
        try:
            self._tree = validate_and_compile(expression)
        except SyntaxError as exc:
            raise CustomProblemError(f"Expresion invalida: {exc}") from exc
        except UnsafeExpressionError as exc:
            raise CustomProblemError(f"Expresion no permitida: {exc}") from exc
        self._expression = expression

    @property
    def discrete_values(self) -> list[float]:
        return [0.0, 1.0]

    @property
    def dim(self) -> int:
        return self._n

    @property
    def bounds(self) -> list[tuple[float, float]]:
        return self._bounds

    def _decode_genome(self, solution: list[float]) -> list[Any]:
        if self._kind == "binary":
            return [int(round(v)) for v in solution]
        if self._kind == "permutation":
            return [int(round(v)) for v in solution]
        return list(solution)

    def evaluate(self, solution: list[float]) -> float:
        genome = self._decode_genome(solution)
        scope = {**self._extra_variables, self._genome_var_name: genome, "n": self._n}
        try:
            result = evaluate_expression(self._tree, scope)
        except UnsafeExpressionError as exc:
            raise CustomProblemError(f"La expresion excedio los limites de seguridad al evaluarla: {exc}") from exc
        except ExpressionEvaluationError as exc:
            raise CustomProblemError(f"Error al evaluar la expresion de coste: {exc}") from exc
        try:
            return float(result)
        except (TypeError, ValueError) as exc:
            raise CustomProblemError(
                f"La expresion de coste debe devolver un numero, devolvio: {result!r}"
            ) from exc

    def repair(self, solution: list[float]) -> list[float]:
        if self._kind == "continuous":
            return [min(max(v, lo), hi) for v, (lo, hi) in zip(solution, self._bounds)]
        if self._kind == "binary":
            return [1.0 if v >= 0.5 else 0.0 for v in solution]
        # permutation: garantiza una permutacion valida sin importar que
        # operador de cruce/mutacion se haya usado (defensa en profundidad;
        # con el cruce OX esto nunca deberia hacer falta, pero protege
        # contra elegir un cruce no disenado para permutaciones).
        return _repair_permutation(solution, self._n)

    def random_solution(self, rng: np.random.Generator) -> list[float]:
        if self._kind == "continuous":
            return [rng.uniform(lo, hi) for (lo, hi) in self._bounds]
        if self._kind == "binary":
            return [float(v) for v in rng.integers(0, 2, size=self._n)]
        return [float(v) for v in rng.permutation(self._n)]

    def decode_for_viz(self, solution: list[float]) -> Any:
        genome = self._decode_genome(solution)
        if self._decode == "selected_indices":
            return [i for i, v in enumerate(genome) if v == 1]
        if self._decode == "tour":
            return genome
        return genome

    def surface_grid(self, resolution: int = 60) -> dict[str, Any] | None:
        return None


def _repair_permutation(solution: list[float], n: int) -> list[float]:
    ints = [int(round(v)) for v in solution]
    seen: set[int] = set()
    result: list[int | None] = [None] * len(ints)
    bad_positions = []
    for i, v in enumerate(ints):
        if 0 <= v < n and v not in seen:
            seen.add(v)
            result[i] = v
        else:
            bad_positions.append(i)
    missing = [v for v in range(n) if v not in seen]
    for pos, val in zip(bad_positions, missing):
        result[pos] = val
    return [float(v) for v in result]


# --------------------------------------------------------------------------
# Presets didacticos: Viajante de Comercio (TSP) y Mochila 0-1 (Knapsack).
# --------------------------------------------------------------------------

TSP_EXPRESSION = "sum(distance[tour[i]][tour[(i + 1) % n]] for i in range(n))"
KNAPSACK_EXPRESSION = (
    "sum(value[i] * x[i] for i in range(n)) "
    "- penalty * max(0, sum(weight[i] * x[i] for i in range(n)) - capacity)"
)


def _euclidean_distance_matrix(points: np.ndarray) -> list[list[float]]:
    diff = points[:, None, :] - points[None, :, :]
    dist = np.sqrt((diff**2).sum(axis=-1))
    return dist.tolist()


def tsp_problem(n: int = 12, seed: int = 42) -> CustomExpressionProblem:
    """Genera una instancia aleatoria (pero reproducible via `seed`) del
    problema del viajante de comercio: `n` ciudades con coordenadas
    aleatorias en un plano [0, 100] x [0, 100], distancia euclidiana."""
    rng = np.random.default_rng(seed)
    points = rng.uniform(0, 100, size=(n, 2))
    distance = _euclidean_distance_matrix(points)
    problem = CustomExpressionProblem(
        name="tsp",
        kind="permutation",
        n=n,
        expression=TSP_EXPRESSION,
        maximize=False,
        variables={"distance": distance},
        genome_var_name="tour",
        decode="tour",
    )
    problem.cities = points.tolist()  # para dibujar el mapa en el frontend
    return problem


def knapsack_problem(n: int = 15, seed: int = 7, capacity_ratio: float = 0.5) -> CustomExpressionProblem:
    """Genera una instancia aleatoria (pero reproducible via `seed`) del
    problema de la mochila 0-1: `n` items con peso y valor aleatorios, y una
    capacidad igual a `capacity_ratio` del peso total (para que la
    restriccion sea relevante). El exceso de capacidad se penaliza
    directamente en la expresion de coste."""
    rng = np.random.default_rng(seed)
    weight = rng.integers(1, 50, size=n).astype(float).tolist()
    value = rng.integers(1, 100, size=n).astype(float).tolist()
    capacity = round(sum(weight) * capacity_ratio, 2)
    problem = CustomExpressionProblem(
        name="knapsack",
        kind="binary",
        n=n,
        expression=KNAPSACK_EXPRESSION,
        maximize=True,
        variables={"weight": weight, "value": value, "capacity": capacity, "penalty": max(value) * 2},
        genome_var_name="x",
        decode="selected_indices",
    )
    problem.weight = weight
    problem.value = value
    problem.capacity = capacity
    return problem


def build_custom_problem(definition: dict[str, Any]) -> CustomExpressionProblem:
    """Construye un `CustomExpressionProblem` a partir de una definicion en
    JSON enviada por el usuario (via la API), tipicamente desde el
    constructor de problemas personalizados del frontend."""
    try:
        kind = definition["gene_type"]
        n = int(definition["n"])
        expression = definition["expression"]
    except KeyError as exc:
        raise CustomProblemError(f"Falta el campo requerido: {exc}") from exc
    bounds = definition.get("bounds")
    if isinstance(bounds, list) and bounds and not isinstance(bounds[0], (list, tuple)):
        bounds = tuple(bounds)  # [lo, hi] unico -> se replica para las n variables
    elif isinstance(bounds, list):
        bounds = [tuple(b) for b in bounds]
    return CustomExpressionProblem(
        name=definition.get("name") or "custom",
        kind=kind,
        n=n,
        expression=expression,
        maximize=bool(definition.get("maximize", True)),
        variables=definition.get("variables") or {},
        bounds=bounds,
        genome_var_name=definition.get("genome_var_name"),
    )
