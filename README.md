# Anti-Mul — Real-time Intelligence for Financial Threats

> A graph-based money muling detection engine with an interactive fraud visualization dashboard.

---

## 🚀 Features

- **3 Detection Engines** — Cycle detection, smurfing (fan-out) analysis, and shell chain identification
- **Interactive Graph Visualization** — Cytoscape.js-powered network graph with multiple layout options
- **Risk Scoring** — Multi-factor suspicion scoring with interaction bonuses and density adjustments
- **Time Travel** — Temporal slider to replay transactions over time
- **Account Deep-Dive** — Click any node for detailed account forensics
- **Multiple Views** — Graph, Heatmap, Fraud Rings table, JSON inspector, and Architecture view
- **Graph Pan Sliders** — Horizontal and vertical sliders for precise graph navigation
- **Layout Switcher** — Switch between Default, Force-Directed, Circle, Concentric, and Grid layouts
- **PDF Export** — Generate downloadable fraud analysis reports
- **Command Palette** — Quick search for accounts and rings (Ctrl+K)
- **Neo4j Integration** — Optional typed graph representation (Legitimate, CycleParticipant, SmurfingHub, ShellNode)

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.9+, FastAPI, Uvicorn |
| **Graph Processing** | NetworkX |
| **Graph Database** | Neo4j (optional) |
| **Data Processing** | Pandas |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Visualization** | Cytoscape.js |
| **Deployment** | Any ASGI-compatible server |

---

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Static)                     │
│  index.html │ app.js │ styles.css │ Cytoscape.js        │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP API
┌──────────────────────▼──────────────────────────────────┐
│                FastAPI Backend (main.py)                 │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Graph   │  │  Detection   │  │  Scoring &       │   │
│  │  Builder │  │  Engines     │  │  Confidence      │   │
│  │          │  │              │  │                  │   │
│  │ CSV Parse│  │ • Cycles     │  │ • Base Weights   │   │
│  │ Validate │  │ • Smurfing   │  │ • Interaction    │   │
│  │ Build DAG│  │ • Shell Chain│  │ • Density Guard  │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│                                                          │
│  ┌──────────────────┐  ┌────────────────────────────┐   │
│  │ Layout Engine    │  │ Neo4j Sync (optional)      │   │
│  │ graph_layout.py  │  │ neo4j_graph.py             │   │
│  └──────────────────┘  └────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 🔬 Algorithm Approach

### 1. Circular Fund Routing (Cycle Detection)
- **Algorithm**: Depth-Limited DFS with canonical deduplication
- **Constraints**: Cycle length 3–5 hops, ≤72-hour time span, amount ratio ≤1.25
- **Complexity**: O(V × d^k), pruned by time/amount constraints

### 2. Smurfing Detection (Fan-in / Fan-out)
- **Algorithm**: Sliding Window Analysis
- **Logic**: Identifies hub accounts with ≥10 distinct counterparties within 72-hour windows
- **Guards**: Variance guard (reduces score for high amount variance), diversity dampening

### 3. Layered Shell Networks
- **Algorithm**: Constrained Path Search (DFS)
- **Logic**: Directed acyclic paths of length 3–8 through intermediate "shell" accounts (degree 2–3)
- **Guards**: 72-hour time constraint, amount ratio ≤3.0, minimum amount ≥100

### Suspicion Scoring (0–100)
| Factor | Weight |
|--------|--------|
| Cycle participation | 40 pts |
| Smurfing pattern | 30 pts |
| Shell chain membership | 25 pts |
| High velocity (>5 tx/24h) | 10 pts |
| Multi-pattern interaction bonus | +10 pts |
| Structural confidence | 0.8x–1.2x multiplier |
| Density adjustment | Reduces false positives |

---

## ⚡ Installation & Setup

### Prerequisites
- Python 3.9+
- pip

### 1. Clone the repository
```bash
git clone https://github.com/veera-raghav/RIFT26QC.git
cd RIFT26QC
```

### 2. Install dependencies
```bash
pip install -r backend/requirements.txt
```

### 3. Run the server
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Open in browser
Navigate to **http://localhost:8000** — the frontend is served automatically.

### 5. Neo4j (optional)
For a persistent typed graph representation:
```bash
# Docker example
docker run -d -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j:5

# Set env before running the server
set NEO4J_URI=neo4j://localhost:7687
set NEO4J_USER=neo4j
set NEO4J_PASSWORD=password
```
After `POST /analyze`, the graph syncs to Neo4j. Use `GET /neo4j/graph` or query with Cypher.

---

## 📖 Usage

### Web Interface
1. Open the application in your browser
2. Drag & drop a transaction CSV file onto the upload area (or click to browse)
3. The system validates the schema and displays a preview
4. Click **Analyze Transactions** to run the detection pipeline
5. Explore results via the interactive dashboard:
   - **Graph** — Interactive network visualization with pan sliders and layout options
   - **Heatmap** — Risk score distribution across accounts
   - **Fraud Rings** — Sortable table of detected fraud ring clusters
   - **JSON Output** — Raw results with copy/download
   - **Architecture** — System architecture overview

### Input CSV Format
```csv
transaction_id,sender_id,receiver_id,amount,timestamp
TX_001,ACC_A,ACC_B,1000.00,2025-01-15 08:00:00
TX_002,ACC_B,ACC_C,950.00,2025-01-15 10:30:00
```

- **Transaction limit**: Up to **10,000 transactions** per analysis
- Required columns: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Upload CSV, returns full analysis + graph layout |
| `GET` | `/download-json` | Download latest analysis as JSON |
| `GET` | `/account/{id}` | Deep-dive data for a specific account |
| `GET` | `/neo4j/graph` | Typed graph from Neo4j (if configured) |
| `GET` | `/health` | Health check |

---

## 🗂 Project Structure

```
RIFT26QC/
├── backend/
│   ├── main.py              # FastAPI app, routes, static serving
│   ├── graph_builder.py     # CSV parsing, validation, graph construction
│   ├── cycle_detector.py    # Circular fund routing detection
│   ├── smurf_detector.py    # Fan-in/out smurfing detection
│   ├── shell_detector.py    # Layered shell chain detection
│   ├── scoring_engine.py    # Multi-factor suspicion scoring
│   ├── confidence_engine.py # Structural confidence calculation
│   ├── density_guard.py     # False-positive density adjustment
│   ├── graph_layout.py      # Force-directed graph layout
│   ├── neo4j_graph.py       # Neo4j sync (optional typed graph)
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── index.html           # Dashboard UI
│   ├── app.js               # Frontend logic & Cytoscape.js
│   └── styles.css           # Dark theme styling
└── README.md
```

---

## 🚀 Deployment

### Option 1: Render (Recommended - Free Tier)

1. **Sign up** at [render.com](https://render.com) (free account)
2. **Connect your GitHub** repository
3. **Create a new Web Service**:
   - Repository: `veera-raghav/RIFT26QC`
   - Build Command: `pip install -r backend/requirements.txt`
   - Start Command: `python -m uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - Environment: `Python 3`
4. **Deploy** — Render will automatically deploy your app
5. Your app will be live at `https://anti-mul.onrender.com` (or your custom domain)

### Option 2: Railway

1. **Sign up** at [railway.app](https://railway.app)
2. **New Project** → **Deploy from GitHub repo**
3. Select `veera-raghav/RIFT26QC`
4. Railway auto-detects Python and deploys
5. Your app will be live at `https://anti-mul.up.railway.app`

### Option 3: Docker Deployment

```bash
# Build the image
docker build -t anti-mul .

# Run the container
docker run -p 8000:8000 anti-mul

# Or with docker-compose (includes optional Neo4j)
docker-compose up
```

### Option 4: Fly.io

1. **Install flyctl**: [fly.io/docs/getting-started/installing-flyctl](https://fly.io/docs/getting-started/installing-flyctl/)
2. **Log in**: `fly auth login`
3. **Deploy** (from project root):
   ```bash
   fly launch   # First time: creates app, use existing fly.toml
   fly deploy   # Subsequent deploys
   ```
4. Your app will be live at `https://anti-mul.fly.dev` (or the app name you chose).

---

## ⚠ Known Limitations

- **In-Memory Processing** — Entire graph loaded into memory; for >100K transactions, a database-backed approach is recommended
- **Synchronous Processing** — Large files may timeout; async task queues recommended for production
- **Shell Chain Sensitivity** — Dense graphs can produce aggressive detection; mitigated via strict time/amount constraints

---

## 📄 License

This project is for educational and research purposes.
