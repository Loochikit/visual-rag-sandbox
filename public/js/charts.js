/**
 * charts.js
 * Configures and updates Chart.js instances for RAG observability.
 */

class ObservabilityCharts {
  constructor() {
    this.latencyChart = null;
    this.scoreChart = null;
    this.costChart = null;
    
    this.initCharts();
  }

  initCharts() {
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#8e9bb3", font: { size: 9 } }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#8e9bb3", font: { size: 9 } }
        }
      }
    };

    // 1. Latency Chart (Line)
    const ctxLatency = document.getElementById("latencyChart").getContext("2d");
    this.latencyChart = new Chart(ctxLatency, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: "Latency (ms)",
          data: [],
          borderColor: "#00f2fe",
          backgroundColor: "rgba(0, 242, 254, 0.05)",
          fill: true,
          tension: 0.35,
          borderWidth: 2
        }]
      },
      options: {
        ...commonOptions,
        plugins: { legend: { display: false } }
      }
    });

    // 2. Quality Scores Chart (Multi-line)
    const ctxScore = document.getElementById("scoreChart").getContext("2d");
    this.scoreChart = new Chart(ctxScore, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Faithfulness",
            data: [],
            borderColor: "#00e676",
            tension: 0.3,
            borderWidth: 1.5,
            fill: false
          },
          {
            label: "Context Rel",
            data: [],
            borderColor: "#00f2fe",
            tension: 0.3,
            borderWidth: 1.5,
            fill: false
          },
          {
            label: "Answer Rel",
            data: [],
            borderColor: "#4facfe",
            tension: 0.3,
            borderWidth: 1.5,
            fill: false
          }
        ]
      },
      options: {
        ...commonOptions,
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: { color: "#8e9bb3", font: { size: 8 }, boxWidth: 8 }
          }
        },
        scales: {
          ...commonOptions.scales,
          y: {
            min: 0,
            max: 1.0,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#8e9bb3", font: { size: 9 } }
          }
        }
      }
    });

    // 3. Costs / Tokens Chart (Bar)
    const ctxCost = document.getElementById("costChart").getContext("2d");
    this.costChart = new Chart(ctxCost, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{
          label: "Cost (mUSD)",
          data: [],
          backgroundColor: "rgba(255, 145, 0, 0.65)",
          borderColor: "#ff9100",
          borderWidth: 1
        }]
      },
      options: {
        ...commonOptions,
        plugins: { legend: { display: false } }
      }
    });
  }

  /**
   * Refreshes chart datasets with latest SRE records
   * @param {Array<Object>} recentHistory List of recent history query records
   */
  update(recentHistory) {
    if (!recentHistory || recentHistory.length === 0) {
      // Clear data
      [this.latencyChart, this.scoreChart, this.costChart].forEach(chart => {
        chart.data.labels = [];
        chart.data.datasets.forEach(d => d.data = []);
        chart.update();
      });
      return;
    }

    // Limit to last 8 runs for readable plotting space
    const plotData = recentHistory.slice(-8);
    const labels = plotData.map((item, idx) => {
      const time = new Date(item.timestamp);
      return `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
    });

    // 1. Update Latency
    this.latencyChart.data.labels = labels;
    this.latencyChart.data.datasets[0].data = plotData.map(h => h.latency);
    this.latencyChart.update();

    // 2. Update Scores
    this.scoreChart.data.labels = labels;
    this.scoreChart.data.datasets[0].data = plotData.map(h => h.scores.faithfulness);
    this.scoreChart.data.datasets[1].data = plotData.map(h => h.scores.contextRelevance);
    this.scoreChart.data.datasets[2].data = plotData.map(h => h.scores.answerRelevance);
    this.scoreChart.update();

    // 3. Update Costs (Scale by 1000 to show milli-USD for clear values on low scales)
    this.costChart.data.labels = labels;
    this.costChart.data.datasets[0].data = plotData.map(h => h.cost * 1000);
    this.costChart.update();
  }
}

window.ObservabilityCharts = ObservabilityCharts;
