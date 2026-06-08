/**
 * app.js
 * Main client dashboard orchestrator.
 * Handles user interactions, API ingestions, Socket events, and telemetry updates.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Socket.io Client
  const socket = io();

  // Initialize Modules
  const visualizer = new VectorSpaceVisualizer("vectorCanvas");
  const charts = new ObservabilityCharts();

  // DOM Elements
  const docInput = document.getElementById("documentInput");
  const btnIngest = document.getElementById("btnIngest");
  const chunkContainer = document.getElementById("chunkContainer");
  const docLengthVal = document.getElementById("docLengthVal");
  const chunkCountVal = document.getElementById("chunkCountVal");

  const queryInput = document.getElementById("queryInput");
  const btnQuery = document.getElementById("btnQuery");
  const responseBox = document.getElementById("responseBox");
  const promptBox = document.getElementById("promptBox");
  const btnClear = document.getElementById("btnClear");

  // Settings
  const selectProvider = document.getElementById("selectProvider");
  const selectStrategy = document.getElementById("selectStrategy");
  const inputChunkSize = document.getElementById("chunkSize");
  const inputOverlap = document.getElementById("chunkOverlap");
  const inputK = document.getElementById("kSelect");
  const inputApiKey = document.getElementById("apiKey");
  const inputSystemPrompt = document.getElementById("systemPrompt");

  // Metrics
  const valFaithfulness = document.getElementById("valFaithfulness");
  const valContextRel = document.getElementById("valContextRel");
  const valAnswerRel = document.getElementById("valAnswerRel");
  const valTotalQueries = document.getElementById("valTotalQueries");
  const valAvgLatency = document.getElementById("valAvgLatency");
  const valTotalCost = document.getElementById("valTotalCost");

  // Audit Logs
  const auditList = document.getElementById("auditList");

  // Modal
  const modal = document.getElementById("detailModal");
  const modalClose = document.getElementById("modalClose");
  const modalQuery = document.getElementById("modalQuery");
  const modalAnswer = document.getElementById("modalAnswer");
  const modalMetrics = document.getElementById("modalMetrics");
  const modalExplanations = document.getElementById("modalExplanations");
  const modalContext = document.getElementById("modalContext");

  // Load saved API Key from sessionStorage (keeps keys secure, avoids hardcoding)
  if (sessionStorage.getItem("rag_sandbox_api_key")) {
    inputApiKey.value = sessionStorage.getItem("rag_sandbox_api_key");
  }

  // Save key locally on change
  inputApiKey.addEventListener("input", () => {
    sessionStorage.setItem("rag_sandbox_api_key", inputApiKey.value);
  });

  // --- Socket.io Handlers ---

  socket.on("init-state", (state) => {
    console.log("Initial state received:", state);
    docInput.value = state.documentText || "";
    inputChunkSize.value = state.settings.chunkSize;
    inputOverlap.value = state.settings.chunkOverlap;
    selectStrategy.value = state.settings.strategy;
    inputK.value = state.settings.k;
    selectProvider.value = state.settings.provider;
    
    updateProviderStatus(state.settings.provider);
    visualizer.setNodes(state.chunks);
    renderChunkBadges(state.chunks);
    updateMetricsSummary(state.historySummary);
    renderAuditLogs(state.history);
    charts.update(state.historySummary.recent);
  });

  socket.on("state-update", (state) => {
    visualizer.setNodes(state.chunks);
    renderChunkBadges(state.chunks);
    updateMetricsSummary(state.historySummary);
    charts.update(state.historySummary.recent);
  });

  socket.on("settings-updated", (settings) => {
    inputChunkSize.value = settings.chunkSize;
    inputOverlap.value = settings.chunkOverlap;
    selectStrategy.value = settings.strategy;
    inputK.value = settings.k;
    selectProvider.value = settings.provider;
    updateProviderStatus(settings.provider);
  });

  // Query retrieval event: backend sends top K match coords and text
  socket.on("query-retrieved", (data) => {
    visualizer.projectQuery(data.queryCoords, data.retrieved);
    renderPromptAssembly(data.query, data.retrieved);
  });

  // Streaming start
  socket.on("stream-start", () => {
    responseBox.innerHTML = '<span class="streaming-cursor"></span>';
    btnQuery.disabled = true;
    btnQuery.textContent = "⚙️ Generating...";
  });

  // Token chunks
  socket.on("stream-token", (token) => {
    const cursor = responseBox.querySelector(".streaming-cursor");
    if (cursor) {
      cursor.insertAdjacentHTML("beforebegin", token.replace(/\n/g, "<br>"));
    } else {
      responseBox.innerHTML += token.replace(/\n/g, "<br>");
    }
    responseBox.scrollTop = responseBox.scrollHeight;
  });

  socket.on("stream-end", () => {
    const cursor = responseBox.querySelector(".streaming-cursor");
    if (cursor) cursor.remove();
    btnQuery.disabled = false;
    btnQuery.textContent = "⚡ Execute Query";
  });

  socket.on("eval-start", () => {
    valFaithfulness.textContent = "⏳";
    valContextRel.textContent = "⏳";
    valAnswerRel.textContent = "⏳";
  });

  socket.on("query-complete", (data) => {
    const record = data.record;
    
    // Update live evaluation panels
    animateScoreUpdate(valFaithfulness, record.scores.faithfulness);
    animateScoreUpdate(valContextRel, record.scores.contextRelevance);
    animateScoreUpdate(valAnswerRel, record.scores.answerRelevance);

    // Update charts & history log
    updateMetricsSummary(data.summary);
    charts.update(data.summary.recent);
    
    // Add record to dynamic list
    fetch("/api/v1/state")
      .then(res => res.json())
      .then(state => renderAuditLogs(state.history));
  });

  socket.on("query-error", (errMsg) => {
    responseBox.innerHTML = `<div style="color: var(--accent-red); font-weight: 600;">⚠️ Error: ${errMsg}</div>`;
    btnQuery.disabled = false;
    btnQuery.textContent = "⚡ Execute Query";
  });

  // --- Interaction Bindings ---

  // Document Ingestion Click
  btnIngest.addEventListener("click", async () => {
    const text = docInput.value.trim();
    if (!text) {
      alert("Please provide document text to split and index.");
      return;
    }

    btnIngest.disabled = true;
    btnIngest.textContent = "⚙️ Chunking...";

    try {
      const response = await fetch("/api/v1/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          chunkSize: parseInt(inputChunkSize.value),
          chunkOverlap: parseInt(inputOverlap.value),
          strategy: selectStrategy.value
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ingestion failed");

      // Notify server of config changes
      socket.emit("update-settings", {
        chunkSize: parseInt(inputChunkSize.value),
        chunkOverlap: parseInt(inputOverlap.value),
        strategy: selectStrategy.value
      });

      console.log("Ingestion successful:", data);
    } catch (err) {
      alert("Ingestion error: " + err.message);
    } finally {
      btnIngest.disabled = false;
      btnIngest.textContent = "⚡ Ingest & Index";
    }
  });

  // Query Submit Click
  btnQuery.addEventListener("click", () => {
    const query = queryInput.value.trim();
    if (!query) return;

    // Save settings configuration
    socket.emit("update-settings", {
      k: parseInt(inputK.value),
      provider: selectProvider.value
    });

    socket.emit("query-submit", {
      query,
      provider: selectProvider.value,
      apiKey: inputApiKey.value,
      systemPrompt: inputSystemPrompt.value
    });
  });

  // Trigger query on Enter key (Ctrl + Enter)
  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      btnQuery.click();
    }
  });

  // Settings syncing updates
  selectProvider.addEventListener("change", () => {
    updateProviderStatus(selectProvider.value);
    socket.emit("update-settings", { provider: selectProvider.value });
  });

  // Database Reset Click
  btnClear.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to clear the Vector Database index and reset history?")) return;
    
    await fetch("/api/v1/clear", { method: "POST" });
    
    responseBox.innerHTML = "Sandbox reset. Load some text to begin.";
    promptBox.innerHTML = "";
    visualizer.clearQuery();
    
    valFaithfulness.textContent = "0.0";
    valContextRel.textContent = "0.0";
    valAnswerRel.textContent = "0.0";
  });

  // Close details modal
  modalClose.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // Close modal when clicking background
  window.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });

  // --- Rendering Helpers ---

  function updateProviderStatus(provider) {
    const dot = document.querySelector(".status-dot");
    const label = document.querySelector(".status-label");
    
    if (provider === "mock") {
      dot.classList.add("simulated");
      label.textContent = "Simulated / Offline Mode";
    } else {
      dot.classList.remove("simulated");
      label.textContent = `Live API: ${provider.toUpperCase()}`;
    }
  }

  function renderChunkBadges(chunks) {
    chunkContainer.innerHTML = "";
    
    docLengthVal.textContent = docInput.value.length.toLocaleString() + " chars";
    chunkCountVal.textContent = chunks.length;

    if (chunks.length === 0) {
      chunkContainer.innerHTML = `<div style="color: var(--text-dark); font-size: 0.8rem; text-align: center; margin-top: 2rem;">No chunks indexed</div>`;
      return;
    }

    chunks.forEach(chunk => {
      const badge = document.createElement("div");
      badge.className = "chunk-badge";
      badge.title = `Preview chunk (${chunk.text.substring(0, 50)}...)`;
      badge.textContent = chunk.id;
      
      badge.addEventListener("click", () => {
        // Highlight corresponding node in visualizer
        const node = visualizer.nodes.find(n => n.id === chunk.id);
        if (node) {
          visualizer.nodes.forEach(n => n.hover = false);
          node.hover = true;
          // highlight briefly
          setTimeout(() => { node.hover = false; }, 4000);
        }
      });

      chunkContainer.appendChild(badge);
    });
  }

  function renderPromptAssembly(query, retrievedChunks) {
    const sysPrompt = inputSystemPrompt.value || "You are a helpful assistant. Answer the user question ONLY based on the provided context.";
    
    let contextMarkup = "";
    retrievedChunks.forEach(chunk => {
      contextMarkup += `<div style="margin-bottom: 0.5rem;"><span class="highlight-ctx">[Doc ID: ${chunk.id}] (cos: ${chunk.score})</span><br>${chunk.text}</div>`;
    });

    promptBox.innerHTML = `
      <div style="color: var(--text-muted); margin-bottom: 0.5rem;">System: ${sysPrompt}</div>
      <div style="color: var(--text-muted); margin-bottom: 0.5rem;">Context:</div>
      <div style="padding-left: 0.5rem; border-left: 2px solid var(--accent-cyan); margin-bottom: 0.5rem;">
        ${contextMarkup || "No context chunks injected"}
      </div>
      <div style="color: var(--text-muted);">User: ${query}</div>
    `;
  }

  function animateScoreUpdate(el, targetVal) {
    let current = 0;
    const interval = setInterval(() => {
      if (current >= targetVal) {
        el.textContent = targetVal.toFixed(2);
        clearInterval(interval);
      } else {
        current += 0.05;
        el.textContent = Math.min(targetVal, current).toFixed(2);
      }
    }, 30);
  }

  function updateMetricsSummary(summary) {
    valTotalQueries.textContent = summary.totals.totalQueries;
    valAvgLatency.textContent = summary.totals.avgLatency + " ms";
    valTotalCost.textContent = `$${summary.totals.totalCost.toFixed(5)}`;
  }

  function renderAuditLogs(history) {
    auditList.innerHTML = "";
    if (!history || history.length === 0) {
      auditList.innerHTML = `<div style="color: var(--text-dark); font-size: 0.75rem; text-align: center;">No queries recorded</div>`;
      return;
    }

    // Render list in reverse chronological order
    history.slice().reverse().forEach(record => {
      const item = document.createElement("div");
      item.className = "audit-item";
      
      const time = new Date(record.timestamp).toLocaleTimeString();
      const color = record.scores.faithfulness >= 0.8 ? "var(--accent-green)" : (record.scores.faithfulness >= 0.5 ? "var(--accent-orange)" : "var(--accent-red)");

      item.innerHTML = `
        <div class="audit-header">
          <span class="audit-query">${record.query}</span>
          <span class="audit-meta" style="color: ${color}; font-weight: bold;">F:${record.scores.faithfulness.toFixed(1)}</span>
        </div>
        <div class="audit-header" style="color: var(--text-muted); font-size: 0.65rem;">
          <span>${record.provider.toUpperCase()} | ${record.latency}ms</span>
          <span>${time}</span>
        </div>
      `;

      item.addEventListener("click", () => openDetailModal(record));
      auditList.appendChild(item);
    });
  }

  function openDetailModal(record) {
    modalQuery.textContent = record.query;
    modalAnswer.innerHTML = record.response.replace(/\n/g, "<br>");
    
    // Set scores
    modalMetrics.innerHTML = `
      <div style="display: flex; gap: 1rem; margin-bottom: 0.5rem; justify-content: space-around;">
        <div>Faithfulness: <strong style="color: var(--accent-green);">${record.scores.faithfulness.toFixed(2)}</strong></div>
        <div>Context Rel: <strong style="color: var(--accent-cyan);">${record.scores.contextRelevance.toFixed(2)}</strong></div>
        <div>Answer Rel: <strong style="color: var(--accent-purple);">${record.scores.answerRelevance.toFixed(2)}</strong></div>
      </div>
      <div style="color: var(--text-muted); font-size: 0.75rem;">
        Latency: <strong>${record.latency}ms</strong> | 
        Tokens: <strong>${record.promptTokens} in / ${record.completionTokens} out</strong> | 
        Cost: <strong>$${record.cost.toFixed(5)}</strong> |
        Method: <strong>${record.evalMethod}</strong>
      </div>
    `;

    // Set explanations
    modalExplanations.innerHTML = `
      <div style="margin-bottom: 0.35rem;"><strong>Faithfulness:</strong> ${record.explanations.faithfulness}</div>
      <div style="margin-bottom: 0.35rem;"><strong>Context Relevance:</strong> ${record.explanations.contextRelevance}</div>
      <div><strong>Answer Relevance:</strong> ${record.explanations.answerRelevance}</div>
    `;

    // Show retrieved chunks details
    let contextMarkup = "";
    record.retrievedChunks.forEach(item => {
      // Find current chunk text dynamically
      const node = visualizer.nodes.find(n => n.id === item.id);
      const chunkText = node ? node.text : "[Chunk text flushed or cleared]";
      contextMarkup += `
        <div style="background: rgba(0,0,0,0.25); border-left: 2px solid var(--accent-cyan); padding: 0.4rem; margin-bottom: 0.5rem; border-radius: 0 4px 4px 0;">
          <div style="font-weight: 600; color: var(--accent-cyan); margin-bottom: 0.2rem;">${item.id.toUpperCase()} (Similarity: ${item.score})</div>
          <div>${chunkText}</div>
        </div>
      `;
    });
    modalContext.innerHTML = contextMarkup || "No context logs available.";

    modal.style.display = "flex";
  }
});
