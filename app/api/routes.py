"""Endpoints REST y WebSocket de la API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.algorithms.genetic.custom_problem import CustomProblemError
from app.api.runs import run_manager
from app.api.schemas import CreateRunRequest, SpeedRequest
from app.core.registry import registry

router = APIRouter(prefix="/api")


@router.get("/algorithms")
def list_algorithms():
    return [descriptor.schema() for descriptor in registry.list()]


@router.get("/algorithms/{algorithm_id}")
def get_algorithm(algorithm_id: str):
    try:
        return registry.get(algorithm_id).schema()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs")
async def create_run(body: CreateRunRequest):
    try:
        run = run_manager.create_and_start(
            algorithm_id=body.algorithm_id,
            problem_id=body.problem_id,
            params=body.params,
            speed_ms=body.speed_ms,
            problem_definition=body.problem_definition,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    except (CustomProblemError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return run.to_summary()


@router.get("/runs")
def list_runs():
    return [run.to_summary() for run in run_manager.list()]


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    try:
        return run_manager.get(run_id).to_summary()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="run no encontrado") from exc


@router.get("/runs/{run_id}/history")
def get_run_history(run_id: str):
    try:
        run = run_manager.get(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="run no encontrado") from exc
    return {"states": run.history, "status": run.status, "problem_meta": run.problem_meta}


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str):
    try:
        return run_manager.pause(run_id).to_summary()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="run no encontrado") from exc


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str):
    try:
        return run_manager.resume(run_id).to_summary()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="run no encontrado") from exc


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str):
    try:
        return run_manager.stop(run_id).to_summary()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="run no encontrado") from exc


@router.post("/runs/{run_id}/speed")
async def set_run_speed(run_id: str, body: SpeedRequest):
    try:
        return run_manager.set_speed(run_id, body.speed_ms).to_summary()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="run no encontrado") from exc


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str):
    run_manager.delete(run_id)
    return {"ok": True}


ws_router = APIRouter()


@ws_router.websocket("/ws/runs/{run_id}")
async def run_websocket(websocket: WebSocket, run_id: str):
    try:
        await run_manager.connect(run_id, websocket)
    except KeyError:
        await websocket.close(code=4404)
        return

    try:
        while True:
            # No esperamos mensajes del cliente; solo mantenemos la conexion
            # abierta para poder hacer 'push' de nuevos estados.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        run_manager.disconnect(run_id, websocket)
