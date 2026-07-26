"""Registra el Algoritmo Genetico en el `AlgorithmRegistry` global."""

from __future__ import annotations

from app.algorithms.genetic.algorithm import GeneticAlgorithm
from app.algorithms.genetic.problems import PROBLEM_FACTORIES
from app.algorithms.genetic.schema import GAParams
from app.core.base import Metaheuristic, OptimizationProblem
from app.core.registry import AlgorithmDescriptor, ProblemDescriptor, registry

PROBLEM_METADATA = {
    "sphere": ("Sphere", "Funcion convexa simple: minimizar x^2 + y^2. Optimo en (0, 0)."),
    "rastrigin": ("Rastrigin", "Funcion multimodal con muchos minimos locales. Optimo en (0, 0)."),
    "ackley": ("Ackley", "Funcion multimodal, muy plana lejos del optimo. Optimo en (0, 0)."),
    "himmelblau": ("Himmelblau", "Funcion con 4 minimos globales identicos."),
    "string_match": ("Coincidencia de cadena", "Evolucionar texto aleatorio hasta igualar 'HELLO WORLD'."),
}


def _make_problem_descriptor(problem_id: str) -> ProblemDescriptor:
    name, description = PROBLEM_METADATA[problem_id]
    return ProblemDescriptor(
        id=problem_id,
        name=name,
        description=description,
        factory=PROBLEM_FACTORIES[problem_id],
    )


def _factory(params: GAParams, problem: OptimizationProblem) -> Metaheuristic:
    return GeneticAlgorithm(params=params, problem=problem)


registry.register(
    AlgorithmDescriptor(
        id="genetic",
        name="Algoritmo Genetico",
        description=(
            "Metaheuristica evolutiva basada en seleccion, cruce y mutacion "
            "sobre una poblacion de individuos."
        ),
        params_model=GAParams,
        problems=[_make_problem_descriptor(pid) for pid in PROBLEM_FACTORIES],
        factory=_factory,
    )
)
