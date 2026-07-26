"""Operadores geneticos: seleccion, cruce y mutacion.

Todos trabajan sobre genomas representados como listas/arrays de floats,
independientemente de si el problema es continuo o discreto (la
"reparacion" a valores validos la hace `OptimizationProblem.repair`).
"""

from __future__ import annotations

import numpy as np


# --------------------------------------------------------------------------
# Seleccion
# --------------------------------------------------------------------------


def _quality(fitness_raw: np.ndarray, maximize: bool) -> np.ndarray:
    """Convierte fitness crudo en un puntaje donde 'mayor es mejor', para
    poder aplicar los mismos operadores de seleccion sin importar si el
    problema original es de maximizacion o minimizacion."""
    return fitness_raw if maximize else -fitness_raw


def tournament_selection(
    population: np.ndarray,
    fitness_raw: np.ndarray,
    maximize: bool,
    rng: np.random.Generator,
    tournament_size: int,
) -> tuple[np.ndarray, int]:
    quality = _quality(fitness_raw, maximize)
    n = len(population)
    candidates = rng.integers(0, n, size=tournament_size)
    winner = int(candidates[np.argmax(quality[candidates])])
    return population[winner], winner


def roulette_selection(
    population: np.ndarray,
    fitness_raw: np.ndarray,
    maximize: bool,
    rng: np.random.Generator,
    **_: object,
) -> tuple[np.ndarray, int]:
    quality = _quality(fitness_raw, maximize)
    shifted = quality - quality.min() + 1e-9
    probs = shifted / shifted.sum()
    idx = int(rng.choice(len(population), p=probs))
    return population[idx], idx


def rank_selection(
    population: np.ndarray,
    fitness_raw: np.ndarray,
    maximize: bool,
    rng: np.random.Generator,
    **_: object,
) -> tuple[np.ndarray, int]:
    quality = _quality(fitness_raw, maximize)
    order = np.argsort(quality)  # peor -> mejor
    ranks = np.empty(len(quality))
    ranks[order] = np.arange(1, len(quality) + 1)
    probs = ranks / ranks.sum()
    idx = int(rng.choice(len(population), p=probs))
    return population[idx], idx


SELECTION_METHODS = {
    "tournament": tournament_selection,
    "roulette": roulette_selection,
    "rank": rank_selection,
}


# --------------------------------------------------------------------------
# Cruce (crossover)
# --------------------------------------------------------------------------


def one_point_crossover(p1: np.ndarray, p2: np.ndarray, rng: np.random.Generator):
    n = len(p1)
    if n < 2:
        return p1.copy(), p2.copy(), {"point": None}
    point = int(rng.integers(1, n))
    c1 = np.concatenate([p1[:point], p2[point:]])
    c2 = np.concatenate([p2[:point], p1[point:]])
    return c1, c2, {"point": point}


def two_point_crossover(p1: np.ndarray, p2: np.ndarray, rng: np.random.Generator):
    n = len(p1)
    if n < 3:
        return one_point_crossover(p1, p2, rng)
    a, b = sorted(int(v) for v in rng.choice(np.arange(1, n), size=2, replace=False))
    c1 = p1.copy()
    c2 = p2.copy()
    c1[a:b] = p2[a:b]
    c2[a:b] = p1[a:b]
    return c1, c2, {"points": [a, b]}


def uniform_crossover(p1: np.ndarray, p2: np.ndarray, rng: np.random.Generator):
    mask = rng.random(len(p1)) < 0.5
    c1 = np.where(mask, p1, p2)
    c2 = np.where(mask, p2, p1)
    return c1, c2, {"mask": mask.tolist()}


def blend_crossover(p1: np.ndarray, p2: np.ndarray, rng: np.random.Generator, alpha: float = 0.5):
    t = rng.uniform(-alpha, 1 + alpha, size=len(p1))
    c1 = p1 + t * (p2 - p1)
    c2 = p2 + t * (p1 - p2)
    return c1, c2, {"alpha": alpha}


CROSSOVER_METHODS = {
    "one_point": one_point_crossover,
    "two_point": two_point_crossover,
    "uniform": uniform_crossover,
    "blend": blend_crossover,
}


# --------------------------------------------------------------------------
# Mutacion
# --------------------------------------------------------------------------


def mutate(
    individual: np.ndarray,
    bounds: list[tuple[float, float]],
    gene_type: str,
    mutation_rate: float,
    mutation_strength: float,
    rng: np.random.Generator,
    discrete_values: list[float] | None = None,
) -> tuple[np.ndarray, list[int]]:
    mutated = individual.copy()
    mask = rng.random(len(mutated)) < mutation_rate
    idxs = np.where(mask)[0]
    for i in idxs:
        lo, hi = bounds[i]
        if gene_type == "discrete" and discrete_values:
            mutated[i] = rng.choice(discrete_values)
        else:
            sigma = mutation_strength * (hi - lo)
            mutated[i] = mutated[i] + rng.normal(0, sigma if sigma > 0 else 1e-6)
    return mutated, idxs.tolist()
