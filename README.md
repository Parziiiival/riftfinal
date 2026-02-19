# Money Muling Detection Engine

> A web-based Financial Forensics Engine that processes transaction data and exposes money muling networks through graph analysis and visualization.

**Live Demo:** *(Update with deployed URL)*

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.9+, FastAPI, Uvicorn |
| Graph Layout | NetworkX (spring layout) |
| Frontend | *(To be added)* |
| Deployment | Vercel / Railway / Render |

---

## System Architecture

```
CSV Upload → POST /analyze
  ├── 1. CSV Parsing & Graph Construction  (graph_builder.py)
  ├── 2. Pattern Detection
  │     ├── Cycle Detection                (cycle_detector.py)
  │     ├── Smurfing Detection             (smurf_detector.py)
  │     └── Shell Chain Detection          (shell_detector.py)
  ├── 3. Confidence Scoring                (confidence_engine.py)
  ├── 4. Density Guard                     (density_guard.py)
  ├── 5. Suspicion Scoring Pipeline        (scoring_engine.py)
  └── 6. Graph Layout Computation          (graph_layout.py)
         ↓
  JSON Response: suspicious_accounts, fraud_rings, summary, graph_data

GET /download-json → strict JSON (no graph_data)
```

All processing is **synchronous** — no async workers, no background jobs. `processing_time_seconds` is tracked in every response.

---

## Algorithm Approach & Complexity

### 1. Graph Construction — `graph_builder.py`
- **Complexity:** O(T) where T = number of transactions
- Builds adjacency list, reverse adjacency list, and per-node statistics
- Strict CSV column validation: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`
- Max 10,000 transactions enforced

### 2. Circular Fund Routing — `cycle_detector.py`
- **Algorithm:** Bounded DFS with canonical deduplication
- **Cycle lengths:** 3–5 (configurable `MIN_CYCLE_LEN`, `MAX_CYCLE_LEN`)
- **Constraints:** Time span ≤72h, amount ratio ≤1.25
- **Complexity:** O(N × D^k), heavily pruned by time/amount constraints

### 3. Smurfing Detection — `smurf_detector.py`
- **Algorithm:** Sliding 72-hour window per node
- **Threshold:** ≥10 distinct counterparties in any window
- **Guards:** Diversity dampening (>0.7 ratio), variance dampening (>0.5 CV)
- **Complexity:** O(N × T_node × log T_node)

### 4. Layered Shell Networks — `shell_detector.py`
- **Algorithm:** Directed acyclic path search with degree constraints
- **Constraint:** Intermediate nodes must have total degree 2–3
- **Path lengths:** 3–8 hops
- **Complexity:** O(N × D^k), constrained by degree limits

---

## Suspicion Score Methodology

Scores are computed on a 0–100 scale, sorted descending:

| Stage | Description |
|-------|------------|
| Base Weights | Cycle: 40, Smurfing: 30, Shell: 25, High Velocity (>5 tx/24h): 10 |
| Interaction Bonus | +10 per additional pattern type; +10 cycle+smurf; +8 cycle+shell |
| Structural Confidence | 0.4×temporal + 0.3×amount + 0.3×tightness → scales score by (0.8 + 0.4×conf) |
| Density Guard | If <30% of neighbors are suspicious → score ×0.8 |
| Percentile Normalization | Rank-based scaling, clamped [0.85, 1.15] multiplier |
| Final | Capped at 100.0 |

---

## API Endpoints

### `POST /analyze`
- **Input:** Multipart CSV file upload
- **Output:** `{ suspicious_accounts, fraud_rings, summary, graph_data }`
- `suspicious_accounts`: sorted descending by `suspicion_score`
- `fraud_rings`: sorted descending by `risk_score`
- `summary`: includes `total_accounts_analyzed`, `suspicious_accounts_flagged`, `fraud_rings_detected`, `processing_time_seconds`

### `GET /download-json`
- Returns strict required JSON only (no `graph_data`)
- `Content-Disposition: attachment; filename=analysis_result.json`

---

## Installation & Setup

```bash
# Clone
git clone https://github.com/veera-raghav/RIFT26QC.git
cd RIFT26QC

# Virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Dependencies
pip install -r backend/requirements.txt

# Run
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## Usage
1. Open `http://localhost:8000/docs` (Swagger UI)
2. Use `POST /analyze` to upload a CSV with columns: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`
3. Use `GET /download-json` to download the strict result JSON

---

## Known Limitations
- **In-memory processing:** Dataset limited to 10,000 transactions
- **Shell chain sensitivity:** Shell detection can be aggressive on dense graphs — tune `INTERMEDIATE_DEGREE_MAX` if false positive rate is high
- **Single-process:** No distributed processing; designed for demo-scale datasets

---

## Team Members
- *(Update with team member names)*
