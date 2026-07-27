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
// RENDERIZADO VIRTUALIZADO: con ejecuciones largas (muchas generaciones
// y/o poblaciones grandes) crear un nodo/arista SVG por cada individuo de
// CADA generacion, para siempre, congela el navegador (el DOM/SVG termina
// con cientos de miles o millones de elementos vivos). Para evitarlo:
//   1) Columnas (generaciones): solo se mantienen montadas en el DOM las
//      columnas visibles en el scroll horizontal del contenedor (+ un
//      margen de columnas de repuesto). Al hacer scroll se desmontan las
//      columnas que salen de vista y se montan las que entran, bajo
//      demanda, leyendo los datos siempre desde `this.states` (que no se
//      pierde: el historial completo lo sigue teniendo `app.js`).
//   2) Filas (individuos): si la poblacion supera `MAX_ROWS`, solo se
//      dibuja una muestra estratificada de individuos por columna (mas el
//      mejor de esa generacion, que siempre se incluye), en vez de la
//      poblacion completa.
//   3) Resaltado de linaje (hover/click): en vez de depender de que los
//      nodos ancestros esten montados, se recalcula el linaje completo
//      directamente desde los datos (`this.states`) y se dibuja como una
//      capa temporal (`overlayGroup`) independiente del grafo principal,
//      por lo que el resaltado SIEMPRE es correcto sin importar que se
//      haya virtualizado/muestreado.
// Con esto, el costo en DOM queda acotado por "columnas visibles x filas
// visibles" en todo momento, sin importar cuan larga sea la corrida.

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

// Maximo de individuos dibujados por columna. Si la poblacion es mayor,
// se muestra una muestra estratificada (mas el mejor de cada generacion).
const MAX_ROWS = 150;
// Columnas de margen (fuera del viewport visible) que se mantienen
// montadas de mas, para que hacer scroll no muestre huecos en blanco.
const COL_BUFFER = 6;
// Limite de seguridad para el recorrido de ancestros al resaltar un
// linaje (evita un recorrido descontrolado en casos patologicos).
const MAX_CHAIN_NODES = 6000;

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
 * Elige `count` indices distribuidos uniformemente en [0, total). Se usa
 * para muestrear individuos cuando la poblacion supera `MAX_ROWS`.
 */
function stratifiedSample(total, count) {
  const set = new Set();
  if (count >= total) {
    for (let i = 0; i < total; i++) set.add(i);
    return set;
  }
  for (let k = 0; k < count; k++) {
    set.add(Math.round((k * (total - 1)) / (count - 1)));
  }
  return set;
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
    this.overlayGroup = null;
    this.popSize = 0;
    this.lastGen = -1;
    this.rowH = 12;
    this.colW = 52;
    this.marginX = 28;
    this.marginY = 18;
    this.states = null;
    this.problemMeta = null;
    this.sampledIdx = null; // null = se dibujan todos los individuos
    this.mountedGens = new Map(); // gen -> {nodeEls:[], edgeEls:[], labelEl, keys:[]}
    this.nodesByKey = new Map(); // key -> <circle> (solo columnas montadas)
    this.metaByKey = new Map(); // key -> info para tooltip (solo montadas)
    this.chainEls = [];
    this.hoverEls = [];
    this.selectedKey = null;
    this._syncScheduled = false;
    this._onScroll = null;
  }

  reset() {
    if (this.container && this._onScroll) {
      this.container.removeEventListener("scroll", this._onScroll);
    }
    this._resetState();
  }

  _ensureSvg(popSize) {
    if (this.svg) return;
    this.popSize = popSize;
    this.sampledIdx = popSize > MAX_ROWS ? stratifiedSample(popSize, MAX_ROWS) : null;
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
    this.overlayGroup = svgEl("g", { class: "flowmap-overlay" });
    this.svg.appendChild(this.defs);
    this.svg.appendChild(this.edgesGroup);
    this.svg.appendChild(this.nodesGroup);
    this.svg.appendChild(this.labelsGroup);
    this.svg.appendChild(this.overlayGroup);
    this.container.innerHTML = "";
    this.container.appendChild(this.svg);

    this._onScroll = () => this._scheduleSync();
    this.container.addEventListener("scroll", this._onScroll, { passive: true });
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
   * `states` (0..states.length-1). En vez de montar TODO en el DOM, solo
   * sincroniza la ventana de columnas actualmente visible (ver
   * `_syncViewport`), lo que mantiene el costo acotado sin importar cuan
   * larga sea la corrida.
   */
  update(states, problemMeta) {
    if (!states || !states.length) return;
    this.states = states;
    this.problemMeta = problemMeta;
    const popSize = states[0].population.length;
    this._ensureSvg(popSize);
    const wasAtEdge = this._isScrolledToEdge();
    this.lastGen = states.length - 1;
    this._growTo(this.lastGen);
    // Si el usuario estaba viendo el borde derecho (la generacion mas
    // reciente), lo seguimos automaticamente a medida que llegan nuevas
    // generaciones (como el auto-scroll de un chat). Si el usuario se
    // desplazo manualmente hacia atras para inspeccionar el historial, se
    // respeta esa posicion y no se lo interrumpe.
    if (wasAtEdge) this.container.scrollLeft = this.container.scrollWidth;
    this._syncViewport();
  }

  _isScrolledToEdge() {
    if (!this.container) return true;
    const slack = this.colW * 2;
    return (
      this.container.scrollLeft + this.container.clientWidth >=
      this.container.scrollWidth - slack
    );
  }

  _scheduleSync() {
    if (this._syncScheduled) return;
    this._syncScheduled = true;
    requestAnimationFrame(() => {
      this._syncScheduled = false;
      this._syncViewport();
    });
  }

  _visibleColRange() {
    const scrollLeft = this.container.scrollLeft || 0;
    const width = this.container.clientWidth || 400;
    const first = Math.floor((scrollLeft - this.marginX) / this.colW) - COL_BUFFER;
    const last = Math.ceil((scrollLeft + width - this.marginX) / this.colW) + COL_BUFFER;
    const lo = Math.max(0, first);
    const hi = Math.min(this.lastGen, Math.max(lo, last));
    return [lo, hi];
  }

  /**
   * Monta las columnas (generaciones) dentro del rango visible actual y
   * desmonta las que quedaron fuera, liberando sus nodos/aristas del DOM.
   * Se llama al llegar nuevas generaciones y al hacer scroll horizontal.
   */
  _syncViewport() {
    if (!this.svg || this.lastGen < 0 || !this.states) return;
    const [lo, hi] = this._visibleColRange();
    for (const gen of Array.from(this.mountedGens.keys())) {
      if (gen < lo || gen > hi) this._unmountGeneration(gen);
    }
    for (let gen = lo; gen <= hi; gen++) {
      if (!this.mountedGens.has(gen)) this._buildGeneration(gen);
    }
  }

  _unmountGeneration(gen) {
    const rec = this.mountedGens.get(gen);
    if (!rec) return;
    rec.nodeEls.forEach((el) => el.remove());
    rec.edgeEls.forEach((el) => el.remove());
    if (rec.labelEl) rec.labelEl.remove();
    rec.keys.forEach((k) => {
      this.nodesByKey.delete(k);
      this.metaByKey.delete(k);
    });
    this.mountedGens.delete(gen);
  }

  _buildGeneration(gen) {
    const state = this.states[gen];
    if (!state) return;
    const maximize = this.problemMeta ? this.problemMeta.maximize : true;
    const x = this._xFor(gen);
    const fits = state.extra && state.extra.population_fitness;
    const bestIdx = findBestIndex(fits, maximize);
    const lineage = gen > 0 ? state.extra && state.extra.lineage : null;

    const nodeEls = [];
    const edgeEls = [];
    const keys = [];

    for (let idx = 0; idx < this.popSize; idx++) {
      if (this.sampledIdx && !this.sampledIdx.has(idx) && idx !== bestIdx) continue;

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
          const x1 = this._xFor(gen - 1);
          const y1 = this._yFor(parentIdx);
          const path = svgEl("path", {
            d: curvePath(x1, y1, x, y),
            class: "flowmap-edge" + (mutatedCount ? " flowmap-edge-mutated" : ""),
            stroke: this._gradientFor(label),
            fill: "none",
          });
          this.edgesGroup.appendChild(path);
          edgeEls.push(path);
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
      nodeEls.push(circle);
      keys.push(k);
      this.nodesByKey.set(k, circle);
      this.metaByKey.set(k, {
        gen,
        idx,
        fitness: fits ? fits[idx] : null,
        label,
        parents,
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

    this.mountedGens.set(gen, { nodeEls, edgeEls, labelEl: genLabel, keys });
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

  _hoverNode(circle) {
    this._clearHover();
    const gen = Number(circle.getAttribute("data-gen"));
    const idx = Number(circle.getAttribute("data-idx"));
    const k = key(gen, idx);
    const meta = this.metaByKey.get(k);
    if (!meta) return;

    this.svg.classList.add("has-hover");
    this._drawAncestryOverlay(gen, idx, "flowmap-hl", "flowmap-hl", this.hoverEls);

    this._showTooltip(meta);
  }

  _clearHover() {
    this.hoverEls.forEach((el) => el.remove());
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
   * Recorre hacia atras TODO el arbol de ancestros de (gen, idx) leyendo
   * los datos directamente de `this.states` (no del DOM), asi que el
   * resultado es siempre correcto sin importar que columnas/filas esten
   * montadas o muestreadas en ese momento. Devuelve los nodos (con su
   * color real) y las aristas necesarias para dibujar el resaltado.
   */
  _ancestryChainData(gen, idx) {
    const nodes = [];
    const edges = [];
    const seen = new Set();
    const queue = [[gen, idx]];
    const maximize = this.problemMeta ? this.problemMeta.maximize : true;

    while (queue.length && seen.size < MAX_CHAIN_NODES) {
      const [g, i] = queue.shift();
      const k = key(g, i);
      if (seen.has(k)) continue;
      seen.add(k);

      const state = this.states[g];
      if (!state) continue;
      const fits = state.extra && state.extra.population_fitness;
      const bestIdx = findBestIndex(fits, maximize);
      let color = COLOR_SOURCE;

      if (g > 0) {
        const lineage = state.extra && state.extra.lineage;
        const rec = lineage && lineage[i];
        if (rec) {
          const info = edgesForRecord(rec);
          color = info.color;
          const mutated = !!(rec.mutated_genes && rec.mutated_genes.length);
          info.parents.forEach((p) => {
            edges.push({ fromGen: g - 1, fromIdx: p, toGen: g, toIdx: i, label: info.label, mutated });
            queue.push([g - 1, p]);
          });
        }
      }
      nodes.push({ gen: g, idx: i, color, isBest: i === bestIdx });
    }
    return { nodes, edges };
  }

  /**
   * Dibuja el linaje completo de (gen, idx) como elementos SVG temporales
   * en `overlayGroup`, independientes del grafo principal (virtualizado).
   * Se acumulan en `targetArray` para poder borrarlos despues.
   */
  _drawAncestryOverlay(gen, idx, nodeClass, edgeClass, targetArray) {
    const { nodes, edges } = this._ancestryChainData(gen, idx);
    edges.forEach((e) => {
      const x1 = this._xFor(e.fromGen);
      const y1 = this._yFor(e.fromIdx);
      const x2 = this._xFor(e.toGen);
      const y2 = this._yFor(e.toIdx);
      const path = svgEl("path", {
        d: curvePath(x1, y1, x2, y2),
        class: `flowmap-edge ${edgeClass}` + (e.mutated ? " flowmap-edge-mutated" : ""),
        stroke: this._gradientFor(e.label),
        fill: "none",
      });
      this.overlayGroup.appendChild(path);
      targetArray.push(path);
    });
    nodes.forEach((n) => {
      const x = this._xFor(n.gen);
      const y = this._yFor(n.idx);
      const circle = svgEl("circle", {
        cx: String(x),
        cy: String(y),
        r: String(n.isBest ? 4.5 : 3),
        class: `flowmap-node ${nodeClass}`,
        fill: n.isBest ? COLOR_BEST : n.color,
      });
      this.overlayGroup.appendChild(circle);
      targetArray.push(circle);
    });
  }

  /**
   * Resalta el linaje COMPLETO (todos los ancestros, incluyendo AMBOS
   * padres en cada cruce, desde la generacion 0 hasta el individuo
   * indicado) y atenua el resto de la red (via CSS, `.has-chain`).
   */
  highlightChain(gen, idx) {
    this.clearChain();
    if (gen == null || idx == null || !this.svg) return;
    const k = key(gen, idx);
    if (!this.metaByKey.has(k)) return;

    this.svg.classList.add("has-chain");
    this._drawAncestryOverlay(gen, idx, "flowmap-chain-node", "flowmap-chain-edge", this.chainEls);
    this.selectedKey = k;
  }

  clearChain() {
    this.chainEls.forEach((el) => el.remove());
    this.chainEls = [];
    if (this.svg) this.svg.classList.remove("has-chain");
    this.selectedKey = null;
  }
}
