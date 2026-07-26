// Mapa de flujo evolutivo UNIFICADO: dibuja el linaje COMPLETO de la
// poblacion (todas las generaciones vistas hasta ahora) como una unica red
// de nodos (individuos) conectados de izquierda a derecha, generacion tras
// generacion. La vista es interactiva:
//   - Pasar el mouse sobre un individuo muestra un tooltip con su
//     operacion, puntaje y padres, y resalta las conexiones de las que
//     proviene (de donde viene ese individuo).
//   - Hacer click en un individuo fija ("pinea") el resaltado de TODO su
//     linaje, desde la generacion 0 hasta la generacion en la que se hizo
//     click, atenuando el resto de la red.
//
// Color de cada linea/nodo segun el tipo de transicion:
//   azul     = elitismo o copia directa (un solo padre, sin recombinar)
//   morado   = cruce real entre dos padres
//   naranja (punteado) = hubo mutacion en ese paso (tiene prioridad)
//   verde    = mejor individuo de esa generacion
//   gris     = semilla (individuo de la generacion 0)
//
// El renderizado es INCREMENTAL: cada llamada a `update()` solo agrega las
// columnas (generaciones) nuevas que aun no se hayan dibujado, en vez de
// reconstruir todo el SVG, para que ejecuciones largas sigan siendo fluidas.

const NS = "http://www.w3.org/2000/svg";

const COLOR_SOURCE = "#6b7793"; // nodos semilla, neutros
const COLOR_KEPT = "#5b8def"; // azul - elitismo o copia directa sin cruce
const COLOR_CROSSOVER = "#b06fe0"; // morado - cruce real entre dos padres
const COLOR_MUTATION = "#e2a33a"; // naranja - hubo mutacion
const COLOR_BEST = "#4ecb71"; // verde - mejor de la generacion

const CROSSOVER_LABELS = {
  one_point: "un punto",
  two_point: "dos puntos",
  uniform: "uniforme",
  blend: "mezcla (blend)",
};

function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const key in attrs) {
    e.setAttribute(key, attrs[key]);
  }
  return e;
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

function key(gen, idx) {
  return `${gen}:${idx}`;
}

/**
 * Vista interactiva del linaje evolutivo completo. Se instancia una vez
 * por pagina y se reutiliza durante toda la sesion; `reset()` se llama al
 * iniciar una nueva ejecucion.
 */
export class FlowMapView {
  constructor(container, tooltipEl, onSelect) {
    this.container = container;
    this.tooltipEl = tooltipEl;
    this.onSelect = onSelect || (() => {});
    this._resetState();
    this._bindEvents();
  }

  _resetState() {
    this.container.innerHTML =
      '<p class="hint">Esperando la primera generacion...</p>';
    this.svg = null;
    this.defs = null;
    this.edgesGroup = null;
    this.nodesGroup = null;
    this.labelsGroup = null;
    this.popSize = 0;
    this.lastGen = -1;
    this.rowH = 12;
    this.colW = 52;
    this.marginX = 28;
    this.marginY = 18;
    this.nodesByKey = new Map();
    this.metaByKey = new Map();
    this.incomingByKey = new Map(); // destKey -> [{fromKey, el}]
    this.chainEls = [];
    this.hoverEls = [];
    this.selectedKey = null;
  }

  reset() {
    this._resetState();
  }

  _ensureSvg(popSize) {
    if (this.svg) return;
    this.popSize = popSize;
    const height = this.marginY * 2 + popSize * this.rowH;
    this.svg = svgEl("svg", {
      width: String(this.marginX * 2 + this.colW),
      height: String(height),
      viewBox: `0 0 ${this.marginX * 2 + this.colW} ${height}`,
      class: "flowmap-svg unified-flowmap-svg",
      role: "img",
      "aria-label": "Mapa de flujo evolutivo completo",
    });
    this.defs = svgEl("defs", {});
    this._ensureSharedGradients();
    this.edgesGroup = svgEl("g", { class: "flowmap-edges" });
    this.nodesGroup = svgEl("g", { class: "flowmap-nodes" });
    this.labelsGroup = svgEl("g", { class: "flowmap-gen-labels" });
    this.svg.appendChild(this.defs);
    this.svg.appendChild(this.edgesGroup);
    this.svg.appendChild(this.nodesGroup);
    this.svg.appendChild(this.labelsGroup);
    this.container.innerHTML = "";
    this.container.appendChild(this.svg);
  }

  // Gradientes horizontales (gris -> color) compartidos por TODAS las
  // aristas de una misma categoria, en vez de uno por arista: como usan
  // objectBoundingBox, un mismo <linearGradient> sirve para cualquier
  // curva sin importar sus coordenadas reales, lo que evita crear miles de
  // definiciones y mantiene el SVG ligero en ejecuciones largas.
  _ensureSharedGradients() {
    const specs = [
      ["kept", COLOR_KEPT],
      ["crossover", COLOR_CROSSOVER],
      ["mutation", COLOR_MUTATION],
    ];
    specs.forEach(([id, color]) => {
      const grad = svgEl("linearGradient", {
        id: `flowmap-grad-${id}`,
        x1: "0%",
        y1: "0%",
        x2: "100%",
        y2: "0%",
      });
      grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": COLOR_SOURCE }));
      grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": color }));
      this.defs.appendChild(grad);
    });
  }

  _gradientFor(label) {
    if (label === "mutacion") return "url(#flowmap-grad-mutation)";
    if (label === "cruce") return "url(#flowmap-grad-crossover)";
    return "url(#flowmap-grad-kept)";
  }

  _yFor(idx) {
    return this.marginY + idx * this.rowH + this.rowH / 2;
  }

  _xFor(gen) {
    return this.marginX + gen * this.colW;
  }

  _growTo(gen) {
    const width = this._xFor(gen) + this.marginX;
    if (Number(this.svg.getAttribute("width")) < width) {
      this.svg.setAttribute("width", String(width));
      const height = this.svg.getAttribute("height");
      this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
  }

  /**
   * Asegura que la red incluya todas las generaciones disponibles en
   * `states` (0..states.length-1), agregando solo las columnas nuevas.
   */
  update(states, problemMeta) {
    if (!states || !states.length) return;
    const popSize = states[0].population.length;
    this._ensureSvg(popSize);
    this._growTo(states.length - 1);

    const maximize = problemMeta ? problemMeta.maximize : true;
    for (let gen = this.lastGen + 1; gen < states.length; gen++) {
      this._addGeneration(gen, states[gen], maximize);
    }
    this.lastGen = states.length - 1;
  }

  _addGeneration(gen, state, maximize) {
    const x = this._xFor(gen);
    const fits = state.extra && state.extra.population_fitness;
    const bestIdx = findBestIndex(fits, maximize);
    const lineage = gen > 0 ? state.extra && state.extra.lineage : null;

    for (let idx = 0; idx < this.popSize; idx++) {
      const y = this._yFor(idx);
      const k = key(gen, idx);
      let color = COLOR_SOURCE;
      let label = "semilla (gen 0)";
      let parents = [];
      let mutatedCount = 0;
      let crossoverMethod = null;

      if (gen > 0 && lineage && lineage[idx]) {
        const rec = lineage[idx];
        const info = edgesForRecord(rec);
        color = info.color;
        label = info.label;
        parents = info.parents;
        mutatedCount = (rec.mutated_genes && rec.mutated_genes.length) || 0;
        crossoverMethod = rec.crossover_method || null;

        parents.forEach((parentIdx) => {
          const fromKey = key(gen - 1, parentIdx);
          const x1 = this._xFor(gen - 1);
          const y1 = this._yFor(parentIdx);
          const path = svgEl("path", {
            d: curvePath(x1, y1, x, y),
            class: "flowmap-edge" + (mutatedCount ? " flowmap-edge-mutated" : ""),
            stroke: this._gradientFor(label),
            fill: "none",
            "data-from": fromKey,
            "data-to": k,
          });
          this.edgesGroup.appendChild(path);
          if (!this.incomingByKey.has(k)) this.incomingByKey.set(k, []);
          this.incomingByKey.get(k).push({ fromKey, el: path });
        });
      }

      const isBest = idx === bestIdx;
      const circle = svgEl("circle", {
        cx: String(x),
        cy: String(y),
        r: String(isBest ? 4.5 : 3),
        class:
          "flowmap-node" +
          (gen === 0 ? " flowmap-node-source" : " flowmap-node-target") +
          (isBest ? " flowmap-node-best" : ""),
        fill: isBest ? COLOR_BEST : color,
        "data-gen": String(gen),
        "data-idx": String(idx),
      });
      this.nodesGroup.appendChild(circle);
      this.nodesByKey.set(k, circle);
      this.metaByKey.set(k, {
        gen,
        idx,
        fitness: fits ? fits[idx] : null,
        label,
        parents,
        parentKeys: parents.map((p) => key(gen - 1, p)),
        mutatedCount,
        crossoverMethod,
        isBest,
      });
    }

    const genLabel = svgEl("text", {
      x: String(x),
      y: String(this.marginY * 2 + this.popSize * this.rowH - 4),
      class: "flowmap-gen-label",
      "text-anchor": "middle",
    });
    genLabel.textContent = String(gen);
    this.labelsGroup.appendChild(genLabel);
  }

  _bindEvents() {
    this.container.addEventListener("mousemove", (evt) => {
      if (!this.tooltipEl || this.tooltipEl.hidden) return;
      this.tooltipEl.style.left = `${evt.clientX + 14}px`;
      this.tooltipEl.style.top = `${evt.clientY + 14}px`;
    });
    this.container.addEventListener("mouseover", (evt) => {
      const circle = evt.target.closest && evt.target.closest("circle.flowmap-node");
      if (circle) this._hoverNode(circle);
    });
    this.container.addEventListener("mouseout", (evt) => {
      const circle = evt.target.closest && evt.target.closest("circle.flowmap-node");
      if (!circle) return;
      const related = evt.relatedTarget;
      if (related && circle.contains(related)) return;
      this._clearHover();
    });
    this.container.addEventListener("click", (evt) => {
      const circle = evt.target.closest && evt.target.closest("circle.flowmap-node");
      if (!circle) return;
      const gen = Number(circle.getAttribute("data-gen"));
      const idx = Number(circle.getAttribute("data-idx"));
      if (this.selectedKey === key(gen, idx)) {
        this.clearChain();
        this.onSelect(null, null);
        return;
      }
      this.onSelect(gen, idx);
    });
  }

  /**
   * Recorre hacia atras TODO el arbol de ancestros de `startKey` (ambos
   * padres en cada cruce, recursivamente, hasta la generacion 0),
   * devolviendo el conjunto de nodos y aristas involucrados. Usa un set de
   * visitados para no repetir trabajo cuando distintas ramas comparten un
   * mismo ancestro, manteniendo el costo acotado por el tamano total del
   * grafo (generaciones x poblacion) en vez de crecer exponencialmente.
   */
  _collectAncestry(startKey) {
    const nodeKeys = new Set();
    const edges = []; // {fromKey, toKey}
    const queue = [startKey];
    while (queue.length) {
      const k = queue.shift();
      if (nodeKeys.has(k)) continue;
      nodeKeys.add(k);
      const meta = this.metaByKey.get(k);
      if (!meta || !meta.parentKeys || !meta.parentKeys.length) continue;
      meta.parentKeys.forEach((pk) => {
        edges.push({ fromKey: pk, toKey: k });
        if (!nodeKeys.has(pk)) queue.push(pk);
      });
    }
    return { nodeKeys, edges };
  }

  /**
   * Marca con `nodeClass`/`edgeClass` todos los nodos y aristas del
   * ancestro completo de `startKey`, acumulando los elementos tocados en
   * `touched` para poder limpiarlos despues.
   */
  _applyAncestryHighlight(startKey, nodeClass, edgeClass, touched) {
    const { nodeKeys, edges } = this._collectAncestry(startKey);
    nodeKeys.forEach((k) => {
      const el = this.nodesByKey.get(k);
      if (el) {
        el.classList.add(nodeClass);
        touched.push(el);
      }
    });
    edges.forEach(({ fromKey, toKey }) => {
      const incoming = this.incomingByKey.get(toKey) || [];
      incoming.forEach((e) => {
        if (e.fromKey === fromKey) {
          e.el.classList.add(edgeClass);
          touched.push(e.el);
        }
      });
    });
  }

  _hoverNode(circle) {
    this._clearHover();
    const gen = Number(circle.getAttribute("data-gen"));
    const idx = Number(circle.getAttribute("data-idx"));
    const k = key(gen, idx);
    const meta = this.metaByKey.get(k);
    if (!meta) return;

    this.svg.classList.add("has-hover");
    this._applyAncestryHighlight(k, "flowmap-hl", "flowmap-hl", this.hoverEls);

    this._showTooltip(meta);
  }

  _clearHover() {
    this.hoverEls.forEach((el) => el.classList.remove("flowmap-hl"));
    this.hoverEls = [];
    if (this.svg) this.svg.classList.remove("has-hover");
    this._hideTooltip();
  }

  _showTooltip(meta) {
    if (!this.tooltipEl) return;
    const parts = [];
    parts.push(`<strong>Generacion ${meta.gen} \u00b7 #${meta.idx}</strong>`);
    const methodSuffix = meta.crossoverMethod
      ? ` (${CROSSOVER_LABELS[meta.crossoverMethod] || meta.crossoverMethod})`
      : "";
    parts.push(`Operacion: ${meta.label}${methodSuffix}`);
    if (meta.fitness != null) parts.push(`Fitness: ${meta.fitness.toFixed(4)}`);
    if (meta.parents.length) {
      const label = meta.parents.length > 1 ? "Padres" : "Padre";
      parts.push(`${label}: ${meta.parents.map((p) => `#${p}`).join(", ")}`);
    }
    if (meta.mutatedCount) parts.push(`${meta.mutatedCount} gen(es) mutado(s)`);
    if (meta.isBest) parts.push("Mejor de la generacion");
    this.tooltipEl.innerHTML = parts.map((p) => `<div>${p}</div>`).join("");
    this.tooltipEl.hidden = false;
  }

  _hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.hidden = true;
  }

  /**
   * Resalta el linaje COMPLETO (todos los ancestros, incluyendo AMBOS
   * padres en cada cruce, desde la generacion 0 hasta el individuo
   * indicado) y atenua el resto de la red.
   */
  highlightChain(gen, idx) {
    this.clearChain();
    if (gen == null || idx == null || !this.svg) return;
    const k = key(gen, idx);
    if (!this.nodesByKey.has(k)) return;

    this.svg.classList.add("has-chain");
    this._applyAncestryHighlight(k, "flowmap-chain-node", "flowmap-chain-edge", this.chainEls);
    this.selectedKey = k;
  }

  clearChain() {
    this.chainEls.forEach((el) =>
      el.classList.remove("flowmap-chain-node", "flowmap-chain-edge")
    );
    this.chainEls = [];
    if (this.svg) this.svg.classList.remove("has-chain");
    this.selectedKey = null;
  }
}

