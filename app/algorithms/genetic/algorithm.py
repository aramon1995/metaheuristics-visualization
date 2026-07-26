"""Implementacion del Algoritmo Genetico como `Metaheuristic`."""

from __future__ import annotations

from typing import Iterator

import numpy as np

from app.algorithms.genetic.operators import (
    CROSSOVER_METHODS,
    SELECTION_METHODS,
    mutate,
)
from app.algorithms.genetic.schema import GAParams
from app.core.base import IterationState, Metaheuristic, OptimizationProblem


class GeneticAlgorithm(Metaheuristic):
    algorithm_id = "genetic"

    def __init__(self, params: GAParams, problem: OptimizationProblem):
        self.params = params
        self.problem = problem
        self.rng = np.random.default_rng(params.seed)

    def _init_population(self) -> np.ndarray:
        return np.array(
            [self.problem.random_solution(self.rng) for _ in range(self.params.population_size)]
        )

    def _evaluate(self, population: np.ndarray) -> np.ndarray:
        return np.array([self.problem.evaluate(ind.tolist()) for ind in population])

    def _build_state(
        self,
        iteration: int,
        population: np.ndarray,
        fitness: np.ndarray,
        lineage: list[dict] | None = None,
    ) -> IterationState:
        maximize = self.problem.maximize
        best_idx = int(np.argmax(fitness) if maximize else np.argmin(fitness))
        worst_idx = int(np.argmin(fitness) if maximize else np.argmax(fitness))
        best_solution = population[best_idx].tolist()
        extra: dict = {
            "best_decoded": self.problem.decode_for_viz(best_solution),
            "maximize": maximize,
            "population_fitness": fitness.tolist(),
        }
        if lineage is not None:
            extra["lineage"] = lineage
        return IterationState(
            iteration=iteration,
            best_fitness=float(fitness[best_idx]),
            avg_fitness=float(np.mean(fitness)),
            worst_fitness=float(fitness[worst_idx]),
            best_solution=best_solution,
            population=population.tolist(),
            extra=extra,
        )

    def run(self) -> Iterator[IterationState]:
        p = self.params
        population = self._init_population()
        fitness = self._evaluate(population)
        yield self._build_state(0, population, fitness)

        selection_fn = SELECTION_METHODS[p.selection_method]
        crossover_fn = CROSSOVER_METHODS[p.crossover_type]
        discrete_values = getattr(self.problem, "discrete_values", None)

        for gen in range(1, p.num_generations + 1):
            maximize = self.problem.maximize
            order = np.argsort(fitness)
            if maximize:
                order = order[::-1]
            elite_idx = order[: p.elitism_count]

            new_population: list[np.ndarray] = []
            lineage: list[dict] = []

            for idx in elite_idx:
                genome = population[idx].tolist()
                new_population.append(population[idx].copy())
                lineage.append(
                    {
                        "kind": "elite",
                        "parent_idx": [int(idx)],
                        "parent_genome": [genome],
                        "crossover_method": None,
                        "crossover_applied": False,
                        "crossover_detail": {},
                        "pre_mutation_genome": genome,
                        "mutated_genes": [],
                        "final_genome": genome,
                    }
                )

            while len(new_population) < p.population_size:
                parent1, idx1 = selection_fn(
                    population, fitness, maximize, self.rng, tournament_size=p.tournament_size
                )
                parent2, idx2 = selection_fn(
                    population, fitness, maximize, self.rng, tournament_size=p.tournament_size
                )
                crossover_applied = bool(self.rng.random() < p.crossover_rate)
                if crossover_applied:
                    child1, child2, crossover_detail = crossover_fn(parent1, parent2, self.rng)
                    crossover_method = p.crossover_type
                else:
                    child1, child2 = parent1.copy(), parent2.copy()
                    crossover_detail = {}
                    crossover_method = None

                for child in (child1, child2):
                    if len(new_population) >= p.population_size:
                        break
                    pre_mutation_genome = child.tolist()
                    mutated_child, mutated_genes = mutate(
                        child,
                        self.problem.bounds,
                        self.problem.gene_type,
                        p.mutation_rate,
                        p.mutation_strength,
                        self.rng,
                        discrete_values=discrete_values,
                    )
                    repaired = np.array(self.problem.repair(mutated_child.tolist()))
                    new_population.append(repaired)
                    lineage.append(
                        {
                            "kind": "offspring",
                            "parent_idx": [idx1, idx2],
                            "parent_genome": [parent1.tolist(), parent2.tolist()],
                            "crossover_method": crossover_method,
                            "crossover_applied": crossover_applied,
                            "crossover_detail": crossover_detail,
                            "pre_mutation_genome": pre_mutation_genome,
                            "mutated_genes": mutated_genes,
                            "final_genome": repaired.tolist(),
                        }
                    )

            population = np.array(new_population)
            fitness = self._evaluate(population)
            for i, rec in enumerate(lineage):
                rec["final_fitness"] = float(fitness[i])
            yield self._build_state(gen, population, fitness, lineage=lineage)
