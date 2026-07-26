// Cliente ligero para la API REST y el WebSocket de una ejecucion (run).

const BASE = "";

async function jsonOrThrow(res) {
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ? JSON.stringify(body.detail) : detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function fetchAlgorithms() {
  const res = await fetch(`${BASE}/api/algorithms`);
  return jsonOrThrow(res);
}

export async function createRun(payload) {
  const res = await fetch(`${BASE}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res);
}

export async function pauseRun(id) {
  return jsonOrThrow(await fetch(`${BASE}/api/runs/${id}/pause`, { method: "POST" }));
}

export async function resumeRun(id) {
  return jsonOrThrow(await fetch(`${BASE}/api/runs/${id}/resume`, { method: "POST" }));
}

export async function stopRun(id) {
  return jsonOrThrow(await fetch(`${BASE}/api/runs/${id}/stop`, { method: "POST" }));
}

export async function setSpeed(id, speedMs) {
  const res = await fetch(`${BASE}/api/runs/${id}/speed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speed_ms: speedMs }),
  });
  return jsonOrThrow(res);
}

export async function getHistory(id) {
  const res = await fetch(`${BASE}/api/runs/${id}/history`);
  return jsonOrThrow(res);
}

export function connectRunSocket(id, handlers) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/runs/${id}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "history" && handlers.onHistory) handlers.onHistory(msg);
    else if (msg.type === "state" && handlers.onState) handlers.onState(msg.state);
    else if (msg.type === "status" && handlers.onStatus) handlers.onStatus(msg.status);
    else if (msg.type === "error" && handlers.onError) handlers.onError(msg.message);
  };
  ws.onclose = () => {
    if (handlers.onClose) handlers.onClose();
  };
  return ws;
}
