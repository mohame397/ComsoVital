const METRICS = {
  heart_rate_bpm: {
    label: "Heart Rate (BPM)",
    color: "#e45757",
    min: 45,
    max: 115
  },
  spo2_percent: {
    label: "Blood Oxygen (SpO2 %)",
    color: "#3978c5",
    min: 88,
    max: 100
  },
  hrv_ms: {
    label: "Heart Rate Variability (ms)",
    color: "#7856a8",
    min: 0,
    max: 140
  },
  core_temperature_c: {
    label: "Core Body Temperature (°C)",
    color: "#e58a35",
    min: 35,
    max: 39
  },
  stress_eda_us: {
    label: "Stress / EDA (µS)",
    color: "#32947b",
    min: 0,
    max: 10
  }
};

const MAX_READINGS = 60;

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid chart timestamp: ${timestamp}`);
  }

  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export class HealthLineChart {
  constructor(canvas, metric) {
    if (typeof Chart === "undefined") {
      throw new Error("Chart.js must be loaded before health-charts.js.");
    }

    if (!METRICS[metric]) {
      throw new Error(`Unknown health chart metric: ${metric}`);
    }

    this.metric = metric;
    this.points = [];
    const config = METRICS[metric];

    this.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: config.label,
          data: [],
          borderColor: config.color,
          backgroundColor: `${config.color}22`,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.25
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          intersect: false,
          mode: "index"
        },
        plugins: {
          legend: {
            display: true,
            position: "top"
          },
          tooltip: {
            callbacks: {
              title: items => items.length ? items[0].label : "",
              label: item => `${config.label}: ${item.formattedValue}`
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Timestamp"
            },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 8,
              maxRotation: 0
            }
          },
          y: {
            title: {
              display: true,
              text: config.label
            },
            suggestedMin: config.min,
            suggestedMax: config.max
          }
        }
      }
    });
  }

  update(point) {
    if (!point || !Number.isFinite(Number(point.value))) {
      throw new TypeError("A chart point must include a finite numeric value.");
    }

    const label = formatTimestamp(point.timestamp);
    this.points.push({
      timestamp: point.timestamp,
      label,
      value: Number(point.value)
    });
    this.points = this.points.slice(-MAX_READINGS);
    this.render();
  }

  setData(points) {
    if (!Array.isArray(points)) {
      throw new TypeError("Chart data must be an array of timestamp/value points.");
    }

    this.points = [];
    points.slice(-MAX_READINGS).forEach(point => {
      if (!point || !Number.isFinite(Number(point.value))) {
        throw new TypeError("Each chart point must include a finite numeric value.");
      }
      this.points.push({
        timestamp: point.timestamp,
        label: formatTimestamp(point.timestamp),
        value: Number(point.value)
      });
    });
    this.render();
  }

  render() {
    this.chart.data.labels = this.points.map(point => point.label);
    this.chart.data.datasets[0].data = this.points.map(point => point.value);
    this.chart.update("none");
  }

  destroy() {
    this.chart.destroy();
  }
}

export function createHealthCharts(container, initialData = {}) {
  if (!container || typeof container.querySelector !== "function") {
    throw new TypeError("Provide a container element for the health charts.");
  }

  const charts = new Map();
  Object.keys(METRICS).forEach(metric => {
    const canvas = container.querySelector(`[data-health-chart="${metric}"]`);
    if (!canvas) {
      return;
    }

    const chart = new HealthLineChart(canvas, metric);
    charts.set(metric, chart);
    if (initialData[metric]) {
      chart.setData(initialData[metric]);
    }
  });

  return {
    update(reading) {
      if (!reading || typeof reading !== "object") {
        throw new TypeError("A health reading must be an object.");
      }

      Object.keys(METRICS).forEach(metric => {
        if (Object.prototype.hasOwnProperty.call(reading, metric)) {
          this.updateMetric(metric, {
            timestamp: reading.timestamp,
            value: reading[metric]
          });
        }
      });
    },

    updateMetric(metric, point) {
      const chart = charts.get(metric);
      if (!chart) {
        throw new Error(`No chart is available for metric: ${metric}`);
      }
      chart.update(point);
    },

    setMetricData(metric, points) {
      const chart = charts.get(metric);
      if (!chart) {
        throw new Error(`No chart is available for metric: ${metric}`);
      }
      chart.setData(points);
    },

    destroy() {
      charts.forEach(chart => chart.destroy());
      charts.clear();
    }
  };
}
