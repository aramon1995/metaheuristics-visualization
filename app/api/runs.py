"""Gestor de ejecuciones (runs) de metaheuristicas.

Se encarga de:
- crear e iniciar una ejecucion en background (asyncio.Task)
- permitir pausar / reanudar / detener / cambiar la velocidad en caliente
- acumular el historial completo (para poder revisar/"replay" tras terminar)
- difundir cada nuevo estado a los clientes WebSocket conectados
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import WebSocket

from app.core.registry import registry

RunStatus = Literal["running", "paused", "finished", "stopped", "error"]


@dataclass
class Run:
    id: str
    algorithm_id: str
    problem_id: str
    raw_params: dict[str, Any]
    problem_meta: dict[str, Any]
    status: RunStatus = "running"
    speed_ms: float = 150.0
    history: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)
    stop_requested: bool = False
    clients: set[WebSocket] = field(default_factory=set)
    task: asyncio.Task | None = None

    def __post_init__(self) -> None:
        self.pause_event.set()  # arranca sin pausa

    def to_summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "algorithm_id": self.algorithm_id,
            "problem_id": self.problem_id,
            "params": self.raw_params,
            "problem_meta": self.problem_meta,
            "status": self.status,
            "speed_ms": self.speed_ms,
            "num_states": len(self.history),
            "error": self.error,
        }


class RunManager:
    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}

    def create_and_start(self, algorithm_id: str, problem_id: str, params: dict[str, Any], speed_ms: float) -> Run:
        descriptor = registry.get(algorithm_id)
        problem_descriptor = descriptor.problem_by_id(problem_id)
        problem = problem_descriptor.factory()
        params_model = descriptor.params_model(**params)
        metaheuristic = descriptor.factory(params_model, problem)

        run_id = uuid.uuid4().hex[:12]
        problem_meta = {
            "id": problem_id,
            "name": problem_descriptor.name,
            "dim": problem.dim,
            "bounds": problem.bounds,
            "maximize": problem.maximize,
            "surface_grid": problem.surface_grid(),
            "target": getattr(problem, "target", None),
        }
        run = Run(
            id=run_id,
            algorithm_id=algorithm_id,
            problem_id=problem_id,
            raw_params=params_model.model_dump(),
            problem_meta=problem_meta,
            speed_ms=speed_ms,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._drive(run, metaheuristic))
        return run

    def get(self, run_id: str) -> Run:
        if run_id not in self._runs:
            raise KeyError(run_id)
        return self._runs[run_id]

    def list(self) -> list[Run]:
        return list(self._runs.values())

    def delete(self, run_id: str) -> None:
        run = self._runs.pop(run_id, None)
        if run and run.task:
            run.task.cancel()

    def pause(self, run_id: str) -> Run:
        run = self.get(run_id)
        run.pause_event.clear()
        run.status = "paused"
        return run

    def resume(self, run_id: str) -> Run:
        run = self.get(run_id)
        run.pause_event.set()
        run.status = "running"
        return run

    def stop(self, run_id: str) -> Run:
        run = self.get(run_id)
        run.stop_requested = True
        run.pause_event.set()  # por si estaba en pausa, para poder salir del bucle
        return run

    def set_speed(self, run_id: str, speed_ms: float) -> Run:
        run = self.get(run_id)
        run.speed_ms = max(0.0, speed_ms)
        return run

    async def connect(self, run_id: str, ws: WebSocket) -> Run:
        run = self.get(run_id)
        await ws.accept()
        run.clients.add(ws)
        await ws.send_json({"type": "history", "states": run.history, "status": run.status})
        return run

    def disconnect(self, run_id: str, ws: WebSocket) -> None:
        run = self._runs.get(run_id)
        if run:
            run.clients.discard(ws)

    async def _broadcast(self, run: Run, message: dict[str, Any]) -> None:
        dead = []
        for ws in run.clients:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            run.clients.discard(ws)

    async def _drive(self, run: Run, metaheuristic) -> None:
        try:
            finished_naturally = True
            for state in metaheuristic.run():
                if run.stop_requested:
                    finished_naturally = False
                    break
                await run.pause_event.wait()
                if run.stop_requested:
                    finished_naturally = False
                    break

                state_dict = state.to_dict()
                run.history.append(state_dict)
                await self._broadcast(run, {"type": "state", "state": state_dict})

                if run.speed_ms > 0:
                    await asyncio.sleep(run.speed_ms / 1000.0)
                else:
                    await asyncio.sleep(0)  # ceder el control del event loop

            run.status = "finished" if finished_naturally else "stopped"
        except Exception as exc:  # pragma: no cover - defensivo, no debe tumbar el server
            run.status = "error"
            run.error = str(exc)
            await self._broadcast(run, {"type": "error", "message": str(exc)})
            return
        await self._broadcast(run, {"type": "status", "status": run.status})


run_manager = RunManager()
