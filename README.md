# 🌌 Visual RAG Sandbox & Debugger // Observability & Telemetry Console

**Visual RAG Sandbox & Debugger** is an interactive, zero-dependency full-stack RAG (Retrieval-Augmented Generation) pipeline simulator and observability console. Designed to showcase core AI systems-engineering principles, it provides a high-fidelity visual interface for inspecting, debugging, and evaluating document search and LLM response pipelines.

Built natively in Node.js, the system runs completely offline out-of-the-box using a custom, in-memory **TF-IDF vector index** and local similarity calculators. It also supports live integrations (OpenAI, Gemini, and Ollama) with secure client-side API routing.

[![Deploy to Render](https://visual-rag-sandbox.onrender.com)

---

## 🚀 Key Engineering Concepts Demonstrated

### 1. Document Chunking & Alignment Strategies
- **Fixed-Character Splitter**: Splits text exactly at a static boundary length with configurable overlap characters.
- **Recursive Character Splitter**: Mimics enterprise splitters (like LangChain) by recursively parsing paragraphs (`\n\n`), sentences (`\n`), words (` `), and characters (`""`) to keep semantic contexts intact while respecting maximum chunk thresholds.

### 2. Math-Based In-Memory Vector Store
- **TF-IDF Vectorization**: Generates numerical N-dimensional vectors representing terms frequency weighed by document rarity.
- **Cosine Similarity Matcher**: Calculates semantic distance via vector dot products ($A \cdot B / (||A|| \cdot ||B||)$) to identify and return the top $K$ relevant text chunks.

### 3. Dimensionality Reduction & Canvas Rendering
- **Random Projection (RP)**: Uses Gaussian-distributed projection matrices (Johnson-Lindenstrauss lemma) to map high-dimensional vector embeddings into stable 2D canvas coordinates.
- **Spring Physics Canvas Simulation**: Interactive HTML5 Canvas driven by a spring-mass force system. Nodes repel each other to avoid overlap, and query nodes draw animated connection links to retrieved context nodes.

### 4. Real-time WebSockets & Generation Streaming
- Streams LLM generation token-by-token using **Socket.io** event conduits.
- Bridges streaming protocols from OpenAI, Gemini, and Ollama REST endpoints transparently back to client terminals.

### 5. Automated "LLM-as-a-Judge" Evaluation
- Computes real-time RAG score metrics:
  - **Faithfulness / Groundedness**: Checks for LLM hallucinations. Assesses if facts in the answer exist in the context.
  - **Context Relevance**: Measures if the retrieved context is relevant to the query.
  - **Answer Relevance**: Checks if the response directly addresses the query.
- Employs lexical token overlaps for offline simulation and JSON-schema structured API judges for live modes.

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js, Express, Socket.io (WebSocket streaming logs), fs (Local database logs).
- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom Glassmorphism, CSS variables, micro-interactions), HTML5 Canvas 2D API (Vector coordinates physics simulation), Chart.js (Observability graphs).

---

## 📂 Project Structure

```
visual-rag-sandbox/
├── README.md               # GitHub Documentation
├── package.json            # Node.js configurations and dependencies
├── server.js               # Express app, Socket.io server, and API router
├── Dockerfile              # Docker container configuration
├── render.yaml             # Render Blueprint for 1-click deployments
├── lib/
│   ├── Chunker.js          # Fixed and recursive splitting algorithms
│   ├── VectorEngine.js     # In-memory TF-IDF indexer and similarity search
│   ├── LlmService.js       # OpenAI/Gemini/Ollama streaming integration
│   └── EvalEngine.js       # Lexical overlap & LLM-as-a-Judge evaluations
└── public/
    ├── index.html          # Semantic dashboard portal
    ├── css/
    │   └── styles.css      # Neon glassmorphism stylesheet
    └── js/
        ├── app.js          # Controller & WebSocket connector
        ├── canvas-vector.js # HTML5 Canvas physics renderer
        └── charts.js       # Chart.js telemetry charts
```

---

## 💻 Local Setup & Execution

### Prerequisites
Make sure you have Node.js (v18+) installed.

### 1. Install Dependencies
Navigate to the project directory and install the packages:
```bash
cd visual-rag-sandbox
npm install
```

### 2. Run the Server
Start the development server:
```bash
npm start
```
*The server will start listening on port **4000**.*

### 3. Access the Dashboard
Open your browser and navigate to:
👉 **`http://localhost:4000`**

---

## 📡 Dual Mode Operation (Simulated vs Live)

### Mode A: Simulated / Offline Mode (Default)
Runs entirely locally with **no API keys required**:
- Text splitting uses local CPU cycles.
- Embedding vectors use a local TF-IDF model.
- LLM response matches query terms against context sentences to construct a smart mocked output.
- Evaluations run lexical Jaccard distance calculations to estimate faithfulness.

### Mode B: Live API Mode
Paste your OpenAI or Gemini key directly into the settings card (saved securely only in your browser's `sessionStorage` and never sent to git) to enable:
- Real-time generation streaming from actual models (`gpt-4o-mini` or `gemini-1.5-flash`).
- LLM-as-a-Judge background evaluation querying JSON-format verification models.

---

## 🚀 Deploying to Render

This project contains a `Dockerfile` and `render.yaml` blueprint, allowing you to deploy to Render's free tier in seconds:

1. Push this folder to your GitHub repository.
2. Log in to [Render.com](https://render.com).
3. Go to **Blueprints** and click **New Blueprint Instance**.
4. Connect your GitHub repository.
5. Render will automatically detect the `render.yaml` configuration, build the Docker container, and deploy it to a free web service!
