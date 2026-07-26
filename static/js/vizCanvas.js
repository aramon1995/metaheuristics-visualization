// Renderiza el espacio de busqueda (mapa de calor de la funcion, cuando el
// problema es continuo en 2D) y la poblacion como puntos sobre ese espacio.

const COLOR_STOPS = [
  [13, 18, 32],
  [30, 60, 114],
  [59, 130, 189],
  [99, 189, 140],
  [220, 220, 90],
  [230, 126, 60],
  [220, 60, 60],
];

function colorFor(t) {
  const n = COLOR_STOPS.length - 1;
  const scaled = Math.min(Math.max(t, 0), 1) * n;
  const idx = Math.min(Math.floor(scaled), n - 1);
  const frac = scaled - idx;
  const [r1, g1, b1] = COLOR_STOPS[idx];
  const [r2, g2, b2] = COLOR_STOPS[idx + 1];
  return [
    Math.round(r1 + (r2 - r1) * frac),
    Math.round(g1 + (g2 - g1) * frac),
    Math.round(b1 + (b2 - b1) * frac),
  ];
}

export class SurfaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.grid = null;
    this.bounds = null;
    this.offscreen = document.createElement("canvas");
  }

  setProblem(bounds, grid) {
    this.bounds = bounds;
    this.grid = grid;
    if (grid) this._renderHeatmapToOffscreen();
  }

  _renderHeatmapToOffscreen() {
    const { x, y, z } = this.grid;
    const w = x.length;
    const h = y.length;
    this.offscreen.width = w;
    this.offscreen.height = h;
    const octx = this.offscreen.getContext("2d");
    const imgData = octx.createImageData(w, h);

    let zmin = Infinity;
    let zmax = -Infinity;
    for (const row of z) {
      for (const v of row) {
        if (v < zmin) zmin = v;
        if (v > zmax) zmax = v;
      }
    }
    const range = zmax - zmin || 1;

    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const t = (z[j][i] - zmin) / range;
        const [r, g, b] = colorFor(t);
        const py = h - 1 - j; // invertir eje Y (cartesiano -> imagen)
        const idx = (py * w + i) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    octx.putImageData(imgData, 0, 0);
  }

  render(population, best) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.grid) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.offscreen, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#0d1220";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (!this.bounds || !population || !population.length) return;
    const [xb, yb] = this.bounds;
    const toPixel = (px, py) => {
      const nx = (px - xb[0]) / (xb[1] - xb[0]);
      const ny = (py - yb[0]) / (yb[1] - yb[0]);
      return [nx * canvas.width, canvas.height - ny * canvas.height];
    };

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (const ind of population) {
      const [cx, cy] = toPixel(ind[0], ind[1]);
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (best) {
      const [cx, cy] = toPixel(best[0], best[1]);
      ctx.strokeStyle = "#ffd54a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export function renderStringViz(container, target, bestSolution) {
  const bestChars = bestSolution.map((v) => String.fromCharCode(Math.round(v)));

  let html = `<span class="target">Objetivo: ${escapeHtml(target)}</span>`;
  html += `<div>`;
  for (let i = 0; i < bestChars.length; i++) {
    const cls = target[i] === bestChars[i] ? "match" : "mismatch";
    html += `<span class="${cls}">${escapeHtml(bestChars[i])}</span>`;
  }
  html += `</div>`;
  container.innerHTML = html;
}


function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
