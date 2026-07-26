# Visualizador de Metaheuristicas

Herramienta didactica para visualizar, en tiempo real y en replay, como
evoluciona el entrenamiento de metaheuristicas. Empieza con el **Algoritmo
Genetico** y esta disenada para anadir facilmente otras (PSO, ACO, ...).

## Arquitectura

- `app/core/`: abstracciones comunes a cualquier metaheuristica
  (`Metaheuristic`, `OptimizationProblem`, `IterationState`) y el
  `AlgorithmRegistry` donde se registran los algoritmos disponibles.
- `app/algorithms/genetic/`: implementacion del Algoritmo Genetico
  (operadores de seleccion/cruce/mutacion, problemas benchmark y el
  problema de coincidencia de cadenas) registrada en el `AlgorithmRegistry`.
- `app/api/`: `RunManager` (orquesta ejecuciones en background con
  pausa/reanudacion/parada/velocidad) y los endpoints REST + WebSocket.
- `templates/` + `static/`: interfaz web (HTML/CSS/JS vanilla, con Chart.js
  vendorizado) que construye el formulario de parametros dinamicamente a
  partir del JSON Schema del algoritmo, visualiza la poblacion en vivo y
  permite revisar (replay) cualquier ejecucion terminada.

Para anadir una nueva metaheuristica (PSO, ACO, ...): crear un paquete en
`app/algorithms/<nombre>/` con su propio modelo de parametros (pydantic),
sus problemas y una clase que implemente `Metaheuristic`, y registrarlo con
`registry.register(AlgorithmDescriptor(...))`. Ni la API ni el frontend
necesitan cambios.

## Requisitos

- [uv](https://docs.astral.sh/uv/)

## Puesta en marcha

```bash
uv sync
uv run uvicorn app.main:app --reload
```

Abrir http://127.0.0.1:8000 en el navegador.
