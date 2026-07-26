// Renderiza el "flujo de cruce y mutacion" de una generacion: para cada
// individuo de la nueva poblacion, muestra de donde vino (padres o
// elitismo), como se cruzo, que mutaciones sufrio y como quedo al final.
// Formato de grafo de flujo (columnas: Padres -> Cruce -> Mutacion ->
// Individuo final), coherente con el resto de tarjetas oscuras de la UI.

function isStringProblem(problemMeta) {
  return !!(problemMeta && problemMeta.target);
}

function decodeGenome(genome) {
  return genome.map((v) => String.fromCharCode(Math.round(v))).join("");
}

function formatGenome(genome, problemMeta) {
  if (!genome) return "-";
  if (isStringProblem(problemMeta)) {
    return decodeGenome(genome);
  }
  if (problemMeta && problemMeta.surface_grid) {
    return `x=${genome[0].toFixed(2)}, y=${genome[1].toFixed(2)}`;
  }
  const shown = genome.slice(0, 6).map((v) => v.toFixed(2));
  return shown.join(", ") + (genome.length > 6 ? ", \u2026" : "");
}

function decodedWithMatchSpans(genome, target) {
  const chars = genome.map((v) => String.fromCharCode(Math.round(v)));
  return chars
    .map((c, i) => {
      const cls = target && target[i] === c ? "match" : "mismatch";
      return `<span class="${cls}">${escapeHtml(c)}</span>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatCrossoverDetail(method, applied, detail) {
  if (!applied) return "Sin cruce (copia directa de un padre)";
  const labels = {
    one_point: "Un punto",
    two_point: "Dos puntos",
    uniform: "Uniforme",
    blend: "Mezcla aritmetica (blend)",
  };
  const label = labels[method] || method || "Cruce";
  let extra = "";
  if (method === "one_point" && detail && detail.point != null) {
    extra = ` &middot; corte en gen ${detail.point}`;
  } else if (method === "two_point" && detail && detail.points) {
    extra = ` &middot; genes ${detail.points[0]}-${detail.points[1]}`;
  } else if (method === "uniform" && detail && detail.mask) {
    const bits = detail.mask.slice(0, 20).map((b) => (b ? "1" : "0")).join("");
    extra = ` &middot; mascara ${bits}${detail.mask.length > 20 ? "\u2026" : ""}`;
  } else if (method === "blend" && detail && detail.alpha != null) {
    extra = ` &middot; alpha=${detail.alpha}`;
  }
  return `${label}${extra}`;
}

function formatMutation(mutatedGenes) {
  if (!mutatedGenes || !mutatedGenes.length) return "Sin mutacion";
  const idxs = mutatedGenes.slice(0, 12).join(", ");
  const more = mutatedGenes.length > 12 ? "\u2026" : "";
  return `${mutatedGenes.length} gen(es) mutado(s) &middot; idx ${idxs}${more}`;
}

function parentNode(idx, genome, problemMeta) {
  const text = formatGenome(genome, problemMeta);
  return `<div class="lineage-node parent"><span class="idx">#${idx}</span><span class="genome">${escapeHtml(text)}</span></div>`;
}

function buildFamilyRow(rec, resultIdx, problemMeta) {
  const row = document.createElement("div");
  row.className = `lineage-family lineage-${rec.kind}`;

  const parentsCol = document.createElement("div");
  parentsCol.className = "lineage-col lineage-parents";
  parentsCol.innerHTML = rec.parent_idx
    .map((idx, i) => parentNode(idx, rec.parent_genome[i], problemMeta))
    .join("");

  const crossoverCol = document.createElement("div");
  crossoverCol.className = "lineage-col";
  const crossoverLabel =
    rec.kind === "elite" ? "Pasa directo (elitismo)" : formatCrossoverDetail(rec.crossover_method, rec.crossover_applied, rec.crossover_detail);
  crossoverCol.innerHTML = `<div class="lineage-node crossover">${crossoverLabel}</div>`;

  const mutationCol = document.createElement("div");
  mutationCol.className = "lineage-col";
  mutationCol.innerHTML = `<div class="lineage-node mutation">${formatMutation(rec.mutated_genes)}</div>`;

  const finalCol = document.createElement("div");
  finalCol.className = "lineage-col";
  const target = problemMeta && problemMeta.target;
  const finalText = isStringProblem(problemMeta)
    ? decodedWithMatchSpans(rec.final_genome, target)
    : escapeHtml(formatGenome(rec.final_genome, problemMeta));
  const fitText = rec.final_fitness != null ? rec.final_fitness.toFixed(3) : "-";
  finalCol.innerHTML = `<div class="lineage-node final"><span class="idx">#${resultIdx}</span><span class="genome">${finalText}</span><span class="fit">fitness ${fitText}</span></div>`;

  row.appendChild(parentsCol);
  row.appendChild(arrow());
  row.appendChild(crossoverCol);
  row.appendChild(arrow());
  row.appendChild(mutationCol);
  row.appendChild(arrow());
  row.appendChild(finalCol);
  return row;
}

function arrow() {
  const span = document.createElement("div");
  span.className = "lineage-arrow";
  span.textContent = "\u2192";
  return span;
}

export function renderLineage(container, genLabelEl, state, problemMeta) {
  const lineage = state && state.extra && state.extra.lineage;
  genLabelEl.textContent = state ? state.iteration : "-";

  if (!lineage || !lineage.length) {
    container.innerHTML =
      '<p class="hint">Generacion inicial: poblacion aleatoria, todavia sin cruces ni mutaciones.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  lineage.forEach((rec, i) => {
    frag.appendChild(buildFamilyRow(rec, i, problemMeta));
  });
  container.innerHTML = "";
  container.appendChild(frag);
}
