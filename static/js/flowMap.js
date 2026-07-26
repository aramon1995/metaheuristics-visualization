// Visualizaciones tipo "mapa de flujo" (estilo Sankey) para el algoritmo
// genetico. Ambas variantes comparten el mismo lenguaje visual:
//   - renderFlowMap: TODA la poblacion en una transicion de generacion,
//     nodos de la generacion anterior (izquierda) conectados con los de la
//     nueva generacion (derecha).
//   - renderIndividualFlowMap: el linaje COMPLETO y lineal de un solo
//     individuo, un nodo por generacion, encadenados de izquierda a
//     derecha desde la semilla (generacion 0) hasta el resultado final.
//
// Color de cada linea/nodo segun el tipo de transicion:
//   azul     = elitismo o copia directa (un solo padre, sin recombinar)
//   morado   = cruce real entre dos padres
//   naranja (punteado) = hubo mutacion en ese paso (tiene prioridad)
//   verde    = nodo destacado (mejor individuo / resultado final)
//   gris     = nodo de origen (generacion anterior / semilla)

const NS = "http://www.w3.org/2000/svg";

const COLOR_SOURCE = "#6b7793"; // nodos de origen, neutros
const COLOR_KEPT = "#5b8def"; // azul - elitismo o copia directa sin cruce
const COLOR_CROSSOVER = "#b06fe0"; // morado - cruce real entre dos padres
const COLOR_MUTATION = "#e2a33a"; // naranja - hubo mutacion
const COLOR_BEST = "#4ecb71"; // verde - nodo destacado

function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const key in attrs) {
    e.setAttribute(key, attrs[key]);
  }
  return e;
}

function makeGradientEdge(defs, id, x1, y1, x2, y2, fromColor, toColor) {
  const grad = svgEl("linearGradient", {
    id,
    gradientUnits: "userSpaceOnUse",
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
  });
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": fromColor }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": toColor }));
  defs.appendChild(grad);
}

function curvePath(x1, y1, x2, y2) {
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`;
}

/**
 * Clasifica una transicion segun si hubo elitismo/copia directa, cruce real
 * o mutacion. La "copia directa" (un padre seleccionado que no se cruzo)
 * se colorea IGUAL que el elitismo porque, en ambos casos, el individuo
 * resultante viene de UN SOLO padre sin recombinar genes; el color morado
 * queda reservado exclusivamente para cuando SI hubo recombinacion real
 * entre dos padres (crossover_applied === true).
 */
function classifyTransition(kind, crossoverApplied, mutated) {
  if (mutated) return { color: COLOR_MUTATION, label: "mutacion" };
  if (kind === "elite") return { color: COLOR_KEPT, label: "elitismo" };
  if (!crossoverApplied) return { color: COLOR_KEPT, label: "copia directa (sin cruce)" };
  return { color: COLOR_CROSSOVER, label: "cruce" };
}

function findBestIndex(fits, maximize) {
  if (!fits || !fits.length) return -1;
  let best = 0;
  for (let i = 1; i < fits.length; i++) {
    if (maximize ? fits[i] > fits[best] : fits[i] < fits[best]) best = i;
  }
  return best;
}

/**
 * Para un registro de linaje de tipo "offspring" sin cruce aplicado
 * (copia directa de un padre), determina cual de los dos padres
 * seleccionados fue realmente el copiado, comparando el genoma previo a la
 * mutacion con el genoma de cada padre candidato.
 */
function directCopySlot(rec) {
  const pre = rec.pre_mutation_genome;
  const genomes = rec.parent_genome;
  if (!genomes || genomes.length < 2 || !pre) return 0;
  const matches0 = genomes[0].every((v, i) => v === pre[i]);
  return matches0 ? 0 : 1;
}

/**
 * Para un registro de linaje, determina la lista de padres que realmente
 * aportaron material genetico (uno solo si fue elitismo o copia directa,
 * dos si hubo cruce real) junto con el color/etiqueta de la transicion.
 */
function edgesForRecord(rec) {
  const mutated = !!(rec.mutated_genes && rec.mutated_genes.length);
  if (rec.kind === "elite") {
    const info = classifyTransition("elite", false, mutated);
    return { parents: [rec.parent_idx[0]], ...info };
  }
  if (!rec.crossover_applied) {
    const slot = directCopySlot(rec);
    const info = classifyTransition("offspring", false, mutated);
    return { parents: [rec.parent_idx[slot]], ...info };
  }
  const info = classifyTransition("offspring", true, mutated);
  return { parents: rec.parent_idx.slice(), ...info };
}

/**
 * Dibuja el mapa de flujo de la transicion generacion (N-1) -> N dentro de
 * `container`, usando los registros de linaje incluidos en `state.extra`.
 */
export function renderFlowMap(container, genLabelEl, state, problemMeta) {
  if (genLabelEl) genLabelEl.textContent = state.iteration;

  const lineage = state.extra && state.extra.lineage;
  container.innerHTML = "";

  if (!lineage || !lineage.length) {
    container.innerHTML =
      '<p class="hint">Esperando la primera generacion con cruces...</p>';
    return;
  }

  const n = lineage.length;
  const rowH = 18;
  const width = 460;
  const height = Math.max(n * rowH, 80) + rowH;
  const leftX = 34;
  const rightX = width - 34;
  const r = 4.5;

  const fits = state.extra.population_fitness;
  const maximize = problemMeta ? problemMeta.maximize : true;
  const bestIdx = findBestIndex(fits, maximize);

  const yFor = (i) => rowH / 2 + i * rowH + rowH / 2;

  const svg = svgEl("svg", {
    width: String(width),
    height: String(height),
    viewBox: `0 0 ${width} ${height}`,
    class: "flowmap-svg",
    role: "img",
    "aria-label": "Mapa de flujo de la generacion",
  });

  const defs = svgEl("defs", {});
  const edgesGroup = svgEl("g", { class: "flowmap-edges" });
  const nodesGroup = svgEl("g", { class: "flowmap-nodes" });

  lineage.forEach((rec, childIdx) => {
    const y2 = yFor(childIdx);
    const { parents, color, label } = edgesForRecord(rec);
    const mutated = !!(rec.mutated_genes && rec.mutated_genes.length);

    parents.forEach((parentIdx, slot) => {
      const y1 = yFor(parentIdx);
      const gradId = `flowmap-grad-${childIdx}-${slot}`;
      makeGradientEdge(defs, gradId, leftX, y1, rightX, y2, COLOR_SOURCE, color);

      const path = svgEl("path", {
        d: curvePath(leftX, y1, rightX, y2),
        class: "flowmap-edge" + (mutated ? " flowmap-edge-mutated" : ""),
        stroke: `url(#${gradId})`,
        fill: "none",
      });
      const title = svgEl("title", {});
      title.textContent = `#${parentIdx} \u2192 #${childIdx} (${label})`;
      path.appendChild(title);
      edgesGroup.appendChild(path);
    });
  });

  for (let i = 0; i < n; i++) {
    const circle = svgEl("circle", {
      cx: String(leftX),
      cy: String(yFor(i)),
      r: String(r),
      class: "flowmap-node flowmap-node-source",
    });
    const title = svgEl("title", {});
    title.textContent = `Generacion anterior \u00b7 #${i}`;
    circle.appendChild(title);
    nodesGroup.appendChild(circle);
  }

  lineage.forEach((rec, i) => {
    const { color, label } = edgesForRecord(rec);
    const isBest = i === bestIdx;
    const circle = svgEl("circle", {
      cx: String(rightX),
      cy: String(yFor(i)),
      r: String(isBest ? r + 2.5 : r),
      class: "flowmap-node flowmap-node-target" + (isBest ? " flowmap-node-best" : ""),
      fill: isBest ? COLOR_BEST : color,
    });
    const title = svgEl("title", {});
    title.textContent = `#${i} \u00b7 ${label}${isBest ? " \u00b7 mejor individuo" : ""}`;
    circle.appendChild(title);
    nodesGroup.appendChild(circle);
  });

  svg.appendChild(defs);
  svg.appendChild(edgesGroup);
  svg.appendChild(nodesGroup);
  container.appendChild(svg);
}

/**
 * Dibuja el linaje COMPLETO y lineal de un individuo (desde la generacion 0
 * hasta la generacion final) como una cadena de nodos conectados de
 * izquierda a derecha, con el mismo lenguaje visual que `renderFlowMap`.
 * La posicion vertical de cada nodo refleja su fitness (mejor arriba, peor
 * abajo), asi que la forma de la cadena tambien deja ver la evolucion del
 * fitness junto con el tipo de transformacion en cada paso.
 */
export function renderIndividualFlowMap(container, chain, problemMeta) {
  container.innerHTML = "";
  if (!chain || !chain.length) {
    container.innerHTML =
      '<p class="hint">Selecciona un individuo para ver su linaje completo.</p>';
    return;
  }

  const n = chain.length;
  const colW = 74;
  const marginX = 30;
  const marginY = 26;
  const width = Math.max((n - 1) * colW, 40) + marginX * 2;
  const height = 190;

  const maximize = problemMeta ? problemMeta.maximize : true;
  const fitnessValues = chain.map((s) => (s.fitness == null ? 0 : s.fitness));
  let minF = Math.min(...fitnessValues);
  let maxF = Math.max(...fitnessValues);
  if (minF === maxF) {
    minF -= 1;
    maxF += 1;
  }

  // Mejor fitness arriba (y pequeno), peor abajo (y grande).
  const yFor = (fitness) => {
    const t = (fitness - minF) / (maxF - minF);
    const better = maximize ? 1 - t : t;
    return marginY + better * (height - marginY * 2 - 14);
  };
  const xFor = (i) => marginX + i * colW;

  const svg = svgEl("svg", {
    width: String(width),
    height: String(height),
    viewBox: `0 0 ${width} ${height}`,
    class: "flowmap-svg trace-flowmap-svg",
    role: "img",
    "aria-label": "Linaje completo del individuo",
  });

  const defs = svgEl("defs", {});
  const edgesGroup = svgEl("g", { class: "flowmap-edges" });
  const nodesGroup = svgEl("g", { class: "flowmap-nodes" });

  for (let i = 1; i < n; i++) {
    const step = chain[i];
    const mutated = !!(step.mutatedGenes && step.mutatedGenes.length);
    const info = classifyTransition(step.kind, !!step.crossoverMethod, mutated);
    const x1 = xFor(i - 1);
    const y1 = yFor(chain[i - 1].fitness == null ? 0 : chain[i - 1].fitness);
    const x2 = xFor(i);
    const y2 = yFor(step.fitness == null ? 0 : step.fitness);
    const gradId = `trace-grad-${i}`;
    makeGradientEdge(defs, gradId, x1, y1, x2, y2, COLOR_SOURCE, info.color);

    const path = svgEl("path", {
      d: curvePath(x1, y1, x2, y2),
      class: "flowmap-edge" + (mutated ? " flowmap-edge-mutated" : ""),
      stroke: `url(#${gradId})`,
      fill: "none",
    });
    const title = svgEl("title", {});
    title.textContent = `Generacion ${i - 1} \u2192 ${i} (${info.label})`;
    path.appendChild(title);
    edgesGroup.appendChild(path);
  }

  chain.forEach((step, i) => {
    const isLast = i === n - 1;
    const x = xFor(i);
    const y = yFor(step.fitness == null ? 0 : step.fitness);

    let color = COLOR_SOURCE;
    let label = "individuo inicial (semilla)";
    if (i > 0) {
      const mutated = !!(step.mutatedGenes && step.mutatedGenes.length);
      const info = classifyTransition(step.kind, !!step.crossoverMethod, mutated);
      color = info.color;
      label = info.label;
    }

    const circle = svgEl("circle", {
      cx: String(x),
      cy: String(y),
      r: String(isLast ? 6.5 : 5),
      class: "flowmap-node flowmap-node-target" + (isLast ? " flowmap-node-best" : ""),
      fill: isLast ? COLOR_BEST : color,
    });
    const title = svgEl("title", {});
    title.textContent = `Generacion ${step.generation} \u00b7 ${label}${
      step.fitness != null ? ` \u00b7 fitness ${step.fitness.toFixed(3)}` : ""
    }${isLast ? " \u00b7 resultado final" : ""}`;
    circle.appendChild(title);
    nodesGroup.appendChild(circle);

    const genLabel = svgEl("text", {
      x: String(x),
      y: String(height - 4),
      class: "flowmap-gen-label",
      "text-anchor": "middle",
    });
    genLabel.textContent = String(step.generation);
    nodesGroup.appendChild(genLabel);
  });

  svg.appendChild(defs);
  svg.appendChild(edgesGroup);
  svg.appendChild(nodesGroup);
  container.appendChild(svg);
}
