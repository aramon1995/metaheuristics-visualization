// Envoltorio simple sobre Chart.js para la grafica de evolucion del fitness.

/* global Chart */

export function createFitnessChart(canvas) {
  const ctx = canvas.getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Mejor", data: [], borderColor: "#4ecb71", tension: 0.15, pointRadius: 0 },
        { label: "Promedio", data: [], borderColor: "#5b8def", tension: 0.15, pointRadius: 0 },
        { label: "Peor", data: [], borderColor: "#e2555a", tension: 0.15, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { title: { display: true, text: "Generacion", color: "#9aa4bb" }, ticks: { color: "#9aa4bb" } },
        y: { ticks: { color: "#9aa4bb" } },
      },
      plugins: { legend: { labels: { color: "#e6e9f0" } } },
    },
  });

  function setAll(states) {
    chart.data.labels = states.map((s) => s.iteration);
    chart.data.datasets[0].data = states.map((s) => s.best_fitness);
    chart.data.datasets[1].data = states.map((s) => s.avg_fitness);
    chart.data.datasets[2].data = states.map((s) => s.worst_fitness);
    chart.update("none");
  }

  return {
    reset() {
      chart.data.labels = [];
      chart.data.datasets.forEach((d) => (d.data = []));
      chart.update("none");
    },
    setAll,
    push(state) {
      chart.data.labels.push(state.iteration);
      chart.data.datasets[0].data.push(state.best_fitness);
      chart.data.datasets[1].data.push(state.avg_fitness);
      chart.data.datasets[2].data.push(state.worst_fitness);
      chart.update("none");
    },
    showUpTo(index, states) {
      setAll(states.slice(0, index + 1));
    },
  };
}
