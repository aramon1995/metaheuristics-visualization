// Reconstruye y renderiza el linaje COMPLETO y LINEAL de un individuo
// concreto: partiendo de la generacion seleccionada, sigue hacia atras al
// "padre principal" (el que mas genes aporto) en cada paso hasta llegar a
// su ancestro en la generacion 0, produciendo una unica cadena (no un
// arbol) que se puede recorrer de arriba a abajo.
//
// Por cada paso de la cadena se clasifica cada gen en:
//   - "seed"      : gen de la poblacion inicial aleatoria (generacion 0)
//   - "kept"      : el gen se mantuvo igual que el ancestro que seguimos
//   - "crossover" : el gen vino del OTRO padre (intercambiado en el cruce)
//   - "mutated"   : el gen cambio por mutacion en ese paso
//   - "blend"     : el cruce fue una mezcla aritmetica (blend), no un
//                   intercambio discreto de genes

function isStringProblem(problemMeta) {
  return !!(problemMeta && problemMeta.target);
}

function geneLabel(problemMeta, i, value) {
  if (isStringProblem(problemMeta)) {
    return String.fromCharCode(Math.round(value));
  }
  if (problemMeta && problemMeta.surface_grid && i < 2) {
    return (i === 0 ? "x=" : "y=") + value.toFixed(2);
  }
  return value.toFixed(2);
}

/**
 * Reconstruye la cadena lineal de ancestros de `states[generation]`'s
 * individuo `index`, retrocediendo hasta la generacion 0.
 */
export function traceIndividualLineage(states, generation, index) {
  const chain = [];
  let genIdx = generation;
  let indivIdx = index;

  while (genIdx >= 0) {
    const state = states[genIdx];
    if (!state) break;

    if (genIdx === 0) {
      const genome = state.population[indivIdx];
      const fits = state.extra && state.extra.population_fitness;
      chain.unshift({
        generation: 0,
        genome,
        fitness: fits ? fits[indivIdx] : null,
        kind: "seed",
        crossoverMethod: null,
        parentIdx: null,
        mutatedGenes: [],
        geneCategories: genome.map(() => "seed"),
      });
      break;
    }

    const lineage = state.extra && state.extra.lineage;
    const rec = lineage ? lineage[indivIdx] : null;
    if (!rec) break;

    let trackedSlot = 0;
    let geneCategories;

    if (rec.kind === "elite") {
      geneCategories = rec.final_genome.map(() => "kept");
    } else if (rec.crossover_method === "blend") {
      geneCategories = rec.final_genome.map((_, i) =>
        rec.mutated_genes.includes(i) ? "mutated" : "blend"
      );
      // Sin intercambio discreto de genes: seguimos al padre que en
      // promedio aporto mas "peso" (mas cercano) como ancestro principal.
      const pre = rec.pre_mutation_genome;
      const dist = rec.parent_genome.map((pg) =>
        pg.reduce((acc, v, i) => acc + Math.abs(v - pre[i]), 0)
      );
      trackedSlot = dist[1] < dist[0] ? 1 : 0;
    } else {
      const pre = rec.pre_mutation_genome;
      const matches = rec.parent_genome.map((pg) =>
        pg.reduce((acc, v, i) => acc + (v === pre[i] ? 1 : 0), 0)
      );
      trackedSlot = matches[1] > matches[0] ? 1 : 0;
      geneCategories = rec.final_genome.map((_, i) => {
        if (rec.mutated_genes.includes(i)) return "mutated";
        return pre[i] === rec.parent_genome[trackedSlot][i] ? "kept" : "crossover";
      });
    }

    chain.unshift({
      generation: genIdx,
      genome: rec.final_genome,
      fitness: rec.final_fitness,
      kind: rec.kind,
      crossoverMethod: rec.crossover_method,
      parentIdx: rec.parent_idx,
      mutatedGenes: rec.mutated_genes,
      geneCategories,
    });

    indivIdx = rec.parent_idx[trackedSlot];
    genIdx -= 1;
  }

  return chain;
}

function describeStep(step) {
  if (step.kind === "seed") return "Individuo de la poblacion inicial (aleatorio).";
  if (step.kind === "elite") {
    return `Paso directo por elitismo desde el individuo #${step.parentIdx[0]} (sin cruce ni mutacion).`;
  }
  const parts = [];
  const method = step.crossoverMethod;
  if (method) {
    const labels = {
      one_point: "un punto",
      two_point: "dos puntos",
      uniform: "uniforme",
      blend: "mezcla aritmetica (blend)",
    };
    parts.push(`Cruce ${labels[method] || method} entre #${step.parentIdx[0]} y #${step.parentIdx[1]}`);
  } else {
    parts.push(`Sin cruce (copia directa de #${step.parentIdx[0]} o #${step.parentIdx[1]})`);
  }
  const mutCount = step.mutatedGenes.length;
  parts.push(mutCount ? `${mutCount} gen(es) mutado(s)` : "sin mutacion");
  return parts.join(" \u00b7 ");
}

function buildStep(step, isLast, problemMeta) {
  const div = document.createElement("div");
  div.className = "trace-step" + (isLast ? " trace-final" : "");

  const marker = document.createElement("div");
  marker.className = "trace-marker";
  div.appendChild(marker);

  const content = document.createElement("div");
  content.className = "trace-content";

  const header = document.createElement("div");
  header.className = "trace-content-header";
  const genLabelEl = document.createElement("span");
  genLabelEl.className = "trace-gen-label";
  genLabelEl.textContent = `Generacion ${step.generation}`;
  header.appendChild(genLabelEl);
  if (step.fitness != null) {
    const fit = document.createElement("span");
    fit.className = "trace-fitness";
    fit.textContent = `fitness ${step.fitness.toFixed(3)}`;
    header.appendChild(fit);
  }
  content.appendChild(header);

  const genomeRow = document.createElement("div");
  genomeRow.className = "trace-genome";
  step.genome.forEach((value, i) => {
    const span = document.createElement("span");
    const cat = step.geneCategories[i];
    span.className = `trace-gene origin-${cat}`;
    span.textContent = geneLabel(problemMeta, i, value);
    genomeRow.appendChild(span);
  });
  content.appendChild(genomeRow);

  const meta = document.createElement("div");
  meta.className = "trace-meta";
  meta.textContent = describeStep(step);
  content.appendChild(meta);

  div.appendChild(content);
  return div;
}

export function renderIndividualTrace(container, chain, problemMeta) {
  container.innerHTML = "";
  if (!chain || !chain.length) {
    container.innerHTML = '<p class="hint">Selecciona un individuo para ver su linaje completo.</p>';
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "trace-timeline";
  chain.forEach((step, i) => {
    wrap.appendChild(buildStep(step, i === chain.length - 1, problemMeta));
  });
  container.appendChild(wrap);
}
