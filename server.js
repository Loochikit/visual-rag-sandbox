/**
 * server.js
 * Main Express server and WebSocket (Socket.io) hub.
 * Orchestrates document chunking, in-memory vector storage, similarity search,
 * LLM streaming APIs, and real-time telemetry pipelines.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Core Engines
const ChunkingEngine = require("./lib/ChunkingEngine");
const VectorEngine = require("./lib/VectorEngine");
const LlmService = require("./lib/LlmService");
const EvalEngine = require("./lib/EvalEngine");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 4000;
const HISTORY_FILE = path.join(__dirname, "history.json");

// In-Memory Instances
const vectorStore = new VectorEngine();
let currentTextSource = ""; // Keeps track of original document text
let systemSettings = {
  chunkSize: 300,
  chunkOverlap: 50,
  strategy: "recursive", // "recursive" | "character"
  k: 3,
  provider: "mock" // "mock" | "openai" | "gemini" | "ollama"
};

// Ensure history file exists
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Load query history
function getHistory() {
  try {
    const data = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Save query history
function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("Failed to save history:", err.message);
  }
}

// Calculate token costs based on model parameters
function calculateCost(provider, promptTokens, completionTokens) {
  // Rates per 1,000,000 tokens
  const rates = {
    openai: { input: 0.15, output: 0.60 }, // gpt-4o-mini rates
    gemini: { input: 0.075, output: 0.30 }, // gemini-1.5-flash rates
    ollama: { input: 0.0, output: 0.0 },
    mock: { input: 0.0, output: 0.0 }
  };

  const modelRates = rates[provider] || { input: 0, output: 0 };
  const inputCost = (promptTokens / 1000000) * modelRates.input;
  const outputCost = (completionTokens / 1000000) * modelRates.output;
  return parseFloat((inputCost + outputCost).toFixed(6));
}

// Helper to broadcast data to all connected clients
function broadcastState() {
  io.emit("state-update", {
    chunks: vectorStore.chunks.map(c => ({
      id: c.id,
      text: c.text,
      startIndex: c.startIndex,
      endIndex: c.endIndex,
      x: c.x,
      y: c.y
    })),
    documentLength: currentTextSource.length,
    settings: systemSettings,
    historySummary: summarizeHistory()
  });
}

// Summarize history for telemetry graphs
function summarizeHistory() {
  const history = getHistory();
  const totals = {
    totalQueries: history.length,
    totalCost: history.reduce((acc, h) => acc + (h.cost || 0), 0),
    avgLatency: history.length ? history.reduce((acc, h) => acc + h.latency, 0) / history.length : 0,
    avgFaithfulness: history.length ? history.reduce((acc, h) => acc + h.scores.faithfulness, 0) / history.length : 0,
    avgAnswerRelevance: history.length ? history.reduce((acc, h) => acc + h.scores.answerRelevance, 0) / history.length : 0,
    avgContextRelevance: history.length ? history.reduce((acc, h) => acc + h.scores.contextRelevance, 0) / history.length : 0
  };

  // Round decimals
  totals.totalCost = parseFloat(totals.totalCost.toFixed(5));
  totals.avgLatency = parseFloat(totals.avgLatency.toFixed(0));
  totals.avgFaithfulness = parseFloat(totals.avgFaithfulness.toFixed(2));
  totals.avgAnswerRelevance = parseFloat(totals.avgAnswerRelevance.toFixed(2));
  totals.avgContextRelevance = parseFloat(totals.avgContextRelevance.toFixed(2));

  return {
    totals,
    recent: history.slice(-10) // last 10 entries for charts
  };
}

// --- REST API API Endpoints ---

// Get current state
app.get("/api/v1/state", (req, res) => {
  res.json({
    chunks: vectorStore.chunks,
    documentLength: currentTextSource.length,
    settings: systemSettings,
    history: getHistory()
  });
});

// Ingest a document
app.post("/api/v1/ingest", (req, res) => {
  const { text, chunkSize, chunkOverlap, strategy } = req.body;
  
  if (!text || text.trim() === "") {
    return res.status(400).json({ error: "Text content is required." });
  }

  // Update server configuration
  if (chunkSize) systemSettings.chunkSize = parseInt(chunkSize);
  if (chunkOverlap !== undefined) systemSettings.chunkOverlap = parseInt(chunkOverlap);
  if (strategy) systemSettings.strategy = strategy;

  currentTextSource = text;

  // Perform text chunking
  let chunks = [];
  if (systemSettings.strategy === "character") {
    chunks = ChunkingEngine.splitByCharacter(text, systemSettings.chunkSize, systemSettings.chunkOverlap);
  } else {
    chunks = ChunkingEngine.splitRecursively(text, systemSettings.chunkSize, systemSettings.chunkOverlap);
  }

  // Load into vector database
  vectorStore.ingest(chunks);

  broadcastState();

  res.json({
    success: true,
    message: `Successfully ingested text into ${chunks.length} chunks.`,
    chunkCount: chunks.length
  });
});

// Clear document index and history
app.post("/api/v1/clear", (req, res) => {
  vectorStore.clear();
  currentTextSource = "";
  saveHistory([]);
  broadcastState();
  res.json({ success: true, message: "Sandbox state and history have been cleared." });
});

// WebSockets Communication Routing
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Push initial load state to newly connected client
  socket.emit("init-state", {
    chunks: vectorStore.chunks.map(c => ({
      id: c.id,
      text: c.text,
      x: c.x,
      y: c.y
    })),
    documentText: currentTextSource,
    settings: systemSettings,
    history: getHistory(),
    historySummary: summarizeHistory()
  });

  // Client updates system settings
  socket.on("update-settings", (newSettings) => {
    systemSettings = { ...systemSettings, ...newSettings };
    socket.broadcast.emit("settings-updated", systemSettings);
  });

  // Client requests a query evaluation pipeline
  socket.on("query-submit", async (data) => {
    const { query, apiKey, provider, systemPrompt } = data;
    if (!query || query.trim() === "") {
      socket.emit("query-error", "Query cannot be empty.");
      return;
    }

    const currentProvider = provider || systemSettings.provider;

    // 1. Vector Search
    const searchResult = vectorStore.search(query, systemSettings.k);
    
    // Broadcast vector search matches immediately to render in canvas
    socket.emit("query-retrieved", {
      query,
      queryCoords: searchResult.queryCoords,
      retrieved: searchResult.results
    });

    if (searchResult.results.length === 0) {
      socket.emit("query-error", "No indexed chunks found. Please ingest a document first.");
      return;
    }

    // 2. Stream LLM Generation
    let fullGeneratedText = "";
    socket.emit("stream-start");

    const apiConfig = {
      openaiKey: apiKey && currentProvider === "openai" ? apiKey : process.env.OPENAI_API_KEY,
      geminiKey: apiKey && currentProvider === "gemini" ? apiKey : process.env.GEMINI_API_KEY,
      ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
      systemPrompt: systemPrompt
    };

    LlmService.stream(
      currentProvider,
      query,
      searchResult.results,
      apiConfig,
      // On Token Received Callback
      (token) => {
        fullGeneratedText += token;
        socket.emit("stream-token", token);
      },
      // On Complete Callback
      async (usageData) => {
        socket.emit("stream-end");

        // 3. RAG Quality Evaluation
        socket.emit("eval-start");
        
        // Prepare API config for eval judge
        const evalApiConfig = {
          provider: currentProvider,
          key: currentProvider === "openai" ? apiConfig.openaiKey : (currentProvider === "gemini" ? apiConfig.geminiKey : null)
        };

        const evalResults = await EvalEngine.evaluate(
          query,
          searchResult.results,
          fullGeneratedText,
          evalApiConfig
        );

        // 4. Persistence and Metrics Calculations
        const cost = calculateCost(currentProvider, usageData.promptTokens, usageData.completionTokens);
        
        const historyRecord = {
          id: `query_${Date.now()}`,
          timestamp: new Date().toISOString(),
          query,
          provider: currentProvider,
          retrievedChunks: searchResult.results.map(r => ({ id: r.id, score: r.score })),
          response: fullGeneratedText,
          latency: usageData.latency,
          promptTokens: usageData.promptTokens,
          completionTokens: usageData.completionTokens,
          cost: cost,
          scores: {
            faithfulness: evalResults.faithfulness,
            contextRelevance: evalResults.contextRelevance,
            answerRelevance: evalResults.answerRelevance
          },
          explanations: evalResults.explanations,
          evalMethod: evalResults.method
        };

        // Save record to local history
        const history = getHistory();
        history.push(historyRecord);
        saveHistory(history);

        // Broadcast updated state to all connected terminals
        io.emit("query-complete", {
          record: historyRecord,
          summary: summarizeHistory()
        });
      },
      // On Error Callback
      (err) => {
        console.error("LLM Service stream failed:", err.message);
        socket.emit("query-error", `LLM Error: ${err.message}`);
      }
    );
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start listening
server.listen(PORT, () => {
  console.log(`\n⚡ Visual RAG Sandbox Server online at http://localhost:${PORT}`);
  console.log(`👉 Access visual portal at http://localhost:${PORT}`);
  console.log(`📂 Database history synced to ${HISTORY_FILE}\n`);
});
