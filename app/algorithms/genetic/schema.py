"""Esquema de parametros del Algoritmo Genetico, validado con pydantic.

El JSON Schema generado a partir de este modelo se usa en el frontend para
construir automaticamente el formulario de configuracion.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class GAParams(BaseModel):
    population_size: int = Field(
        60, ge=4, le=1000, title="Tamano de poblacion",
        description="Numero de individuos en cada generacion.",
    )
    num_generations: int = Field(
        150, ge=1, le=5000, title="Numero de generaciones",
        description="Cuantas generaciones se ejecutaran como maximo.",
    )
    crossover_rate: float = Field(
        0.8, ge=0, le=1, title="Tasa de cruce",
        description="Probabilidad de que dos padres se crucen (si no, pasan tal cual).",
    )
    crossover_type: Literal["one_point", "two_point", "uniform", "blend", "order"] = Field(
        "uniform", title="Tipo de cruce",
        description="'order' (OX) es el recomendado/valido para problemas de tipo permutacion (p.ej. TSP).",
    )
    mutation_rate: float = Field(
        0.05, ge=0, le=1, title="Tasa de mutacion",
        description="Probabilidad de mutar cada gen individualmente.",
    )
    mutation_strength: float = Field(
        0.1, ge=0, le=1, title="Fuerza de mutacion",
        description="Desviacion estandar relativa al rango de la variable (solo genes continuos).",
    )
    selection_method: Literal["tournament", "roulette", "rank"] = Field(
        "tournament", title="Metodo de seleccion",
    )
    tournament_size: int = Field(
        3, ge=2, le=20, title="Tamano de torneo",
        description="Numero de individuos que compiten en cada torneo (si selection_method=tournament).",
    )
    elitism_count: int = Field(
        2, ge=0, le=50, title="Elitismo",
        description="Numero de mejores individuos que pasan directamente a la siguiente generacion.",
    )
    seed: Optional[int] = Field(
        None, title="Semilla aleatoria",
        description="Fija la semilla para reproducir el mismo experimento.",
    )
