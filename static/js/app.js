// Controlador principal de la interfaz: conecta selects/formulario con la
// API, gestiona el ciclo de vida de una ejecucion (crear, pausar, reanudar,
// detener, cambiar velocidad) y el modo de revision (replay) una vez
// terminada, dibujando la poblacion y la grafica de fitness en cada paso.

import {
  fetchAlgorithms,
  createRun,
  pauseRun,
  resumeRun,
  stopRun,
  setSpeed,
  connectRunSocket,
} from "./api.js";
import { buildForm, readFormValues } from "./formBuilder.js";
import { SurfaceRenderer, renderStringViz } from "./vizCanvas.js";
import { createFitnessChart } from "./fitnessChart.js";
import { FlowMapView } from "./flowMap.js";
import { traceIndividualLineage, renderIndividualTrace } from "./individualTrace.js";

const el = (id) => document.getElementById(id);

const algorithmSelect = el("algorithm-select");
const problemSelect = el("problem-select");
const problemDescription = el("problem-description");
const paramsForm = el("params-form");
const btnStart = el("btn-start");
const btnPause = el("btn-pause");
const btnStop = el("btn-stop");
const speedRange = el("speed-range");
const speedValue = el("speed-value");
const statusLine = el("status-line");
const replayPanel = el("replay-panel");
const replayRange = el("replay-range");
const replayValue = el("replay-value");
const replayMax = el("replay-max");
const btnReplayPlay = el("btn-replay-play");
const vizCanvasEl = el("viz-canvas");
const stringVizEl = el("string-viz");
const fitnessChartEl = el("fitness-chart");
const statGen = el("stat-gen");
const statBest = el("stat-best");
const statAvg = el("stat-avg");
const statWorst = el("stat-worst");
const statBestSolution = el("stat-best-solution");
const flowmapBody = el("flowmap-body");
const flowmapTooltip = el("flowmap-tooltip");
const traceIndexInput = el("trace-index");
const btnTraceBest = el("btn-trace-best");
const btnTraceClear = el("btn-trace-clear");
const traceBody = el("trace-body");
const customProblemPanel = el("custom-problem-panel");
const customGeneType = el("custom-gene-type");
const customN = el("custom-n");
const customBounds = el("custom-bounds");
const customExpression = el("custom-expression");
const customVariables = el("custom-variables");
const customMaximize = el("custom-maximize");
const customError = el("custom-error");

const surface = new SurfaceRenderer(vizCanvasEl);
const fitnessChart = createFitnessChart(fitnessChartEl);
const flowMapView = new FlowMapView(flowmapBody, flowmapTooltip, onFlowMapSelect);

let algorithms = [];
let currentAlgorithm = null;
let paramInputs = {};
let ws = null;
let currentRunId = null;
let states = [];
let problemMeta = null;
let isPaused = false;
let replayTimer = null;
let lastState = null;
let traceEnabled = false;

// Buffer de estados recibidos por websocket, para desacoplar la cadencia
// de render (acotada a ~60fps via requestAnimationFrame) de la tasa de
// llegada de mensajes: con `speed_ms` bajo/0 el backend puede emitir mas
// generaciones por segundo de las que el navegador puede dibujar comodamente,
// asi que en vez de renderizar en cada mensaje, se acumulan y se vuelcan
// todos juntos en el siguiente frame disponible.
let pendingStates = [];
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flushPendingStates);
}

function flushPendingStates() {
  flushScheduled = false;
  if (!pendingStates.length) return;
  const batch = pendingStates;
  pendingStates = [];
  states.push(...batch);
  fitnessChart.pushAll(batch);
  renderState(batch[batch.length - 1]);
}

async function init() {
  algorithms = await fetchAlgorithms();
  algorithmSelect.innerHTML = "";
  for (const alg of algorithms) {
    const opt = document.createElement("option");
    opt.value = alg.id;
    opt.textContent = alg.name;
    algorithmSelect.appendChild(opt);
  }
  algorithmSelect.addEventListener("change", onAlgorithmChange);
  problemSelect.addEventListener("change", onProblemChange);
  btnStart.addEventListener("click", onStart);
  btnPause.addEventListener("click", onPauseResume);
  btnStop.addEventListener("click", onStop);
  speedRange.addEventListener("input", onSpeedInput);
  speedRange.addEventListener("change", onSpeedChange);
  replayRange.addEventListener("input", onReplayScrub);
  btnReplayPlay.addEventListener("click", onReplayPlayToggle);
  traceIndexInput.addEventListener("input", onTraceIndexInput);
  btnTraceBest.addEventListener("click", onTraceBest);
  btnTraceClear.addEventListener("click", onTraceClear);
  vizCanvasEl.addEventListener("click", onCanvasClickForTrace);

  onAlgorithmChange();
}

function onAlgorithmChange() {
  const algId = algorithmSelect.value;
  currentAlgorithm = algorithms.find((a) => a.id === algId);
  if (!currentAlgorithm) return;

  problemSelect.innerHTML = "";
  for (const p of currentAlgorithm.problems) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    problemSelect.appendChild(opt);
  }
  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "Personalizado (tu formula de coste)";
  problemSelect.appendChild(customOpt);
  paramInputs = buildForm(paramsForm, currentAlgorithm.params_schema);
  onProblemChange();
}

function onProblemChange() {
  const problemId = problemSelect.value;
  if (problemId === "custom") {
    problemDescription.textContent =
      "Define tu propio problema escribiendo una formula de coste en el pseudolenguaje seguro.";
    customProblemPanel.hidden = false;
    return;
  }
  customProblemPanel.hidden = true;
  const problem = currentAlgorithm.problems.find((p) => p.id === problemId);
  problemDescription.textContent = problem ? problem.description : "";
}

function readCustomProblemDefinition() {
  customError.hidden = true;
  const n = parseInt(customN.value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("La dimension 'n' debe ser un entero >= 1");
  }
  const expression = customExpression.value.trim();
  if (!expression) {
    throw new Error("La expresion de coste no puede estar vacia");
  }
  let variables = {};
  const rawVariables = customVariables.value.trim();
  if (rawVariables) {
    try {
      variables = JSON.parse(rawVariables);
    } catch (err) {
      throw new Error(`Variables auxiliares: JSON invalido (${err.message})`);
    }
  }
  const geneType = customGeneType.value;
  const definition = {
    name: "custom",
    gene_type: geneType,
    n,
    expression,
    maximize: customMaximize.checked,
    variables,
  };
  if (geneType === "continuous") {
    const parts = customBounds.value.split(",").map((v) => parseFloat(v.trim()));
    if (parts.length !== 2 || parts.some((v) => Number.isNaN(v))) {
      throw new Error("Rango invalido, usa el formato 'min, max' (p.ej. -10, 10)");
    }
    definition.bounds = parts;
  }
  return definition;
}

function resetVizForNewRun(meta) {
  problemMeta = meta;
  if (meta.surface_grid) {
    vizCanvasEl.hidden = false;
    stringVizEl.hidden = true;
    surface.setProblem(meta.bounds, meta.surface_grid);
  } else {
    vizCanvasEl.hidden = true;
    stringVizEl.hidden = false;
  }
  fitnessChart.reset();
  states = [];
  pendingStates = [];
  flushScheduled = false;
  replayPanel.hidden = true;
  replayRange.value = 0;
  replayRange.max = 0;
  replayValue.textContent = "0";
  replayMax.textContent = "0";
  flowMapView.reset();
  lastState = null;
  traceEnabled = false;
  traceIndexInput.value = 0;
  traceIndexInput.max = "";
  traceBody.innerHTML =
    '<p class="hint">Selecciona un individuo para ver su linaje completo.</p>';
}

function renderState(state) {
  statGen.textContent = state.iteration;
  statBest.textContent = state.best_fitness.toFixed(4);
  statAvg.textContent = state.avg_fitness.toFixed(4);
  statWorst.textContent = state.worst_fitness.toFixed(4);

  if (!problemMeta) return;

  if (problemMeta.surface_grid) {
    statBestSolution.textContent = `(${state.best_solution.map((v) => v.toFixed(3)).join(", ")})`;
    surface.render(state.population, state.best_solution);
  } else {
    const decoded = state.extra && state.extra.best_decoded;
    if (problemMeta.target) {
      statBestSolution.textContent = decoded || "";
      stringVizEl.hidden = false;
      renderStringViz(stringVizEl, problemMeta.target, state.best_solution);
    } else {
      statBestSolution.textContent = Array.isArray(decoded) ? decoded.join(", ") : decoded || "";
      stringVizEl.hidden = true;
    }
  }

  flowMapView.update(states, problemMeta);

  lastState = state;
  traceIndexInput.max = state.population.length - 1;
  if (traceEnabled) updateTrace();
}

function selectIndividual(gen, idx) {
  flowMapView.highlightChain(gen, idx);
  const chain = traceIndividualLineage(states, gen, idx);
  renderIndividualTrace(traceBody, chain, problemMeta);
}

function onFlowMapSelect(gen, idx) {
  if (gen == null) {
    onTraceClear();
    return;
  }
  traceEnabled = true;
  traceIndexInput.value = idx;
  selectIndividual(gen, idx);
}

function onTraceClear() {
  traceEnabled = false;
  flowMapView.clearChain();
  traceBody.innerHTML =
    '<p class="hint">Selecciona un individuo para ver su linaje completo.</p>';
}

function updateTrace() {
  if (!lastState || !states.length) return;
  let idx = parseInt(traceIndexInput.value, 10);
  if (Number.isNaN(idx)) idx = 0;
  const maxIdx = lastState.population.length - 1;
  idx = Math.min(Math.max(idx, 0), maxIdx);
  traceIndexInput.value = idx;
  selectIndividual(lastState.iteration, idx);
}

function onTraceIndexInput() {
  traceEnabled = true;
  updateTrace();
}

function onTraceBest() {
  if (!lastState || !lastState.extra || !lastState.extra.population_fitness) return;
  const fits = lastState.extra.population_fitness;
  const maximize = problemMeta ? problemMeta.maximize : true;
  let bestIdx = 0;
  for (let i = 1; i < fits.length; i++) {
    if (maximize ? fits[i] > fits[bestIdx] : fits[i] < fits[bestIdx]) bestIdx = i;
  }
  traceIndexInput.value = bestIdx;
  traceEnabled = true;
  updateTrace();
}

function onCanvasClickForTrace(evt) {
  if (!problemMeta || !problemMeta.surface_grid || !lastState) return;
  const [xb, yb] = problemMeta.bounds;
  const rect = vizCanvasEl.getBoundingClientRect();
  const px = (evt.clientX - rect.left) * (vizCanvasEl.width / rect.width);
  const py = (evt.clientY - rect.top) * (vizCanvasEl.height / rect.height);
  const nx = px / vizCanvasEl.width;
  const ny = 1 - py / vizCanvasEl.height;
  const x = xb[0] + nx * (xb[1] - xb[0]);
  const y = yb[0] + ny * (yb[1] - yb[0]);

  let bestIdx = 0;
  let bestDist = Infinity;
  lastState.population.forEach((ind, i) => {
    const dx = ind[0] - x;
    const dy = ind[1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });
  traceIndexInput.value = bestIdx;
  traceEnabled = true;
  updateTrace();
}
function statusLabel(status) {
  return (
    {
      running: "Ejecutando...",
      paused: "En pausa.",
      finished: "Finalizado.",
      stopped: "Detenido.",
      error: "Error durante la ejecucion.",
    }[status] || status
  );
}

async function onStart() {
  const values = readFormValues(paramInputs);
  const payload = {
    algorithm_id: algorithmSelect.value,
    problem_id: problemSelect.value,
    params: values,
    speed_ms: parseFloat(speedRange.value),
  };
  if (problemSelect.value === "custom") {
    try {
      payload.problem_definition = readCustomProblemDefinition();
    } catch (err) {
      customError.textContent = err.message;
      customError.hidden = false;
      return;
    }
  }

  btnStart.disabled = true;
  statusLine.textContent = "Creando ejecucion...";

  let run;
  try {
    run = await createRun(payload);
  } catch (err) {
    statusLine.textContent = `Error: ${err.message}`;
    btnStart.disabled = false;
    return;
  }

  currentRunId = run.id;
  resetVizForNewRun(run.problem_meta);
  isPaused = false;
  btnPause.disabled = false;
  btnPause.textContent = "Pausar";
  btnStop.disabled = false;
  statusLine.textContent = "Ejecutando...";

  if (ws) ws.close();
  ws = connectRunSocket(currentRunId, {
    onHistory(msg) {
      pendingStates = [];
      states = msg.states || [];
      if (states.length) {
        fitnessChart.setAll(states);
        renderState(states[states.length - 1]);
      }
    },
    onState(state) {
      pendingStates.push(state);
      scheduleFlush();
    },
    onStatus(status) {
      // Si quedan estados en el buffer (llegaron justo antes del mensaje
      // de estado final), los volcamos ya mismo para que `states` este
      // completo antes de habilitar el replay.
      if (pendingStates.length) flushPendingStates();
      statusLine.textContent = statusLabel(status);
      if (status === "finished" || status === "stopped" || status === "error") {
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = true;
        if (states.length) enableReplay();
      }
    },
    onError(message) {
      statusLine.textContent = `Error: ${message}`;
    },
  });
}

async function onPauseResume() {
  if (!currentRunId) return;
  if (!isPaused) {
    await pauseRun(currentRunId);
    isPaused = true;
    btnPause.textContent = "Reanudar";
    statusLine.textContent = "En pausa.";
  } else {
    await resumeRun(currentRunId);
    isPaused = false;
    btnPause.textContent = "Pausar";
    statusLine.textContent = "Ejecutando...";
  }
}

async function onStop() {
  if (!currentRunId) return;
  await stopRun(currentRunId);
  btnStop.disabled = true;
  btnPause.disabled = true;
}

function onSpeedInput() {
  speedValue.textContent = speedRange.value;
}

async function onSpeedChange() {
  if (currentRunId) {
    await setSpeed(currentRunId, parseFloat(speedRange.value));
  }
}

function enableReplay() {
  replayPanel.hidden = false;
  replayRange.max = states.length - 1;
  replayRange.value = states.length - 1;
  replayMax.textContent = String(states.length - 1);
  replayValue.textContent = String(states.length - 1);
}

function onReplayScrub() {
  const idx = parseInt(replayRange.value, 10);
  replayValue.textContent = String(idx);
  if (!states.length) return;
  fitnessChart.showUpTo(idx, states);
  renderState(states[idx]);
}

function onReplayPlayToggle() {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
    btnReplayPlay.textContent = "Reproducir";
    return;
  }
  btnReplayPlay.textContent = "Pausar";
  replayTimer = setInterval(() => {
    let idx = parseInt(replayRange.value, 10);
    if (idx >= states.length - 1) {
      clearInterval(replayTimer);
      replayTimer = null;
      btnReplayPlay.textContent = "Reproducir";
      return;
    }
    idx += 1;
    replayRange.value = String(idx);
    onReplayScrub();
  }, 120);
}

init();
