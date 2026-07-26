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
import { renderLineage } from "./lineageFlow.js";
import { renderFlowMap, renderIndividualFlowMap } from "./flowMap.js";
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
const lineageBody = el("lineage-body");
const lineageGen = el("lineage-gen");
const flowmapBody = el("flowmap-body");
const flowmapGen = el("flowmap-gen");
const traceIndexInput = el("trace-index");
const btnTraceBest = el("btn-trace-best");
const traceFlowmap = el("trace-flowmap");
const traceBody = el("trace-body");

const surface = new SurfaceRenderer(vizCanvasEl);
const fitnessChart = createFitnessChart(fitnessChartEl);

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
  paramInputs = buildForm(paramsForm, currentAlgorithm.params_schema);
  onProblemChange();
}

function onProblemChange() {
  const problemId = problemSelect.value;
  const problem = currentAlgorithm.problems.find((p) => p.id === problemId);
  problemDescription.textContent = problem ? problem.description : "";
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
  replayPanel.hidden = true;
  replayRange.value = 0;
  replayRange.max = 0;
  replayValue.textContent = "0";
  replayMax.textContent = "0";
  lineageGen.textContent = "-";
  lineageBody.innerHTML =
    '<p class="hint">Esperando la primera generacion con cruces...</p>';
  flowmapGen.textContent = "-";
  flowmapBody.innerHTML =
    '<p class="hint">Esperando la primera generacion con cruces...</p>';
  lastState = null;
  traceEnabled = false;
  traceIndexInput.value = 0;
  traceIndexInput.max = "";
  traceFlowmap.innerHTML =
    '<p class="hint">Selecciona un individuo para ver su linaje completo.</p>';
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
    statBestSolution.textContent = decoded || "";
    renderStringViz(stringVizEl, problemMeta.target || "", state.best_solution);
  }

  renderLineage(lineageBody, lineageGen, state, problemMeta);
  renderFlowMap(flowmapBody, flowmapGen, state, problemMeta);

  lastState = state;
  traceIndexInput.max = state.population.length - 1;
  if (traceEnabled) updateTrace();
}

function updateTrace() {
  if (!lastState || !states.length) return;
  let idx = parseInt(traceIndexInput.value, 10);
  if (Number.isNaN(idx)) idx = 0;
  const maxIdx = lastState.population.length - 1;
  idx = Math.min(Math.max(idx, 0), maxIdx);
  traceIndexInput.value = idx;
  const chain = traceIndividualLineage(states, lastState.iteration, idx);
  renderIndividualFlowMap(traceFlowmap, chain, problemMeta);
  renderIndividualTrace(traceBody, chain, problemMeta);
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
      states = msg.states || [];
      if (states.length) {
        fitnessChart.setAll(states);
        renderState(states[states.length - 1]);
      }
    },
    onState(state) {
      states.push(state);
      fitnessChart.push(state);
      renderState(state);
    },
    onStatus(status) {
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
