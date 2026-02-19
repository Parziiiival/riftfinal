# Money Muling Detection Engine

## Live Demo URL
*Place your deployed application URL here (e.g., https://money-muling-detection.vercel.app)*

## Project Title
**Money Muling Detection Engine** - A Graph-Based Financial Forensics Tool

## Tech Stack
-   **Language**: Python 3.9+
-   **Framework**: FastAPI (High-performance web framework)
-   **Graph Processing**: NetworkX (Graph algorithms)
-   **Data Processing**: Pandas (Data manipulation)
-   **Server**: Uvicorn (ASGI server)

## System Architecture
The application is designed as a high-performance, synchronous processing engine that ingests transaction data and builds a directed graph representation of financial flows.

1.  **Ingestion Layer**: Parses CSV uploads, validates schema (`graph_builder.py`), and normalizes data.
2.  **Graph Construction**: Builds an in-memory directed graph (`GraphData`) with adjacency lists and node statistics.
3.  **Detection Engine**: Runs three parallel detection algorithms (`cycle_detector.py`, `smurf_detector.py`, `shell_detector.py`).
4.  **Scoring & Ranking**: Aggregates risk scores using a weighted model with interaction bonuses and density adjustments (`scoring_engine.py`, `confidence_engine.py`, `density_guard.py`).
5.  **API Layer**: Exposes `POST /analyze` and `GET /download-json` endpoints (`main.py`).

## Algorithm Approach

### 1. Circular Fund Routing (Cycle Detection)
-   **Algorithm**: Depth-Limited Depth-First Search (DFS) with canonical deduplication.
-   **Constraints**:
    -   Cycle length between 3 and 5 hops.
    -   Total time span ≤ 72 hours.
    -   Amount ratio (max/min) ≤ 1.25.
-   **Complexity**: O(V * d^k) where d is average degree and k is max depth (5). Pruned by constraints.

### 2. Smurfing Detection (Fan-in / Fan-out)
-   **Algorithm**: Sliding Window Analysis.
-   **Logic**:
    -   Identify "hub" accounts with ≥ 10 distinct counterparties.
    -   Sliding 72-hour window maximizing unique counterparties.
    -   **Variance Guard**: Reduces score if transaction amounts vary significantly (high standard deviation).
    -   **Diversity Check**: Dampens score if the hub interacts with too many unique entities relative to total transactions.

### 3. Layered Shell Networks
-   **Algorithm**: Constrained Path Search (DFS).
-   **Logic**:
    -   Finds directed acyclic paths of length ≥ 3 (up to 8).
    -   **Intermediate Node Constraint**: Nodes between source and sink must have a total degree between 2 and 3.
    -   **No Branching**: Intermediate nodes must pass funds directly to the next node in the chain.
    -   **Guards**: 72-hour time constraint, amount ratio ≤ 3.0, minimum amount ≥ 100.
-   **Scoring**: Uses "tightness score" (inverse of average intermediate degree).

## Suspicion Score Methodology
Scores are calculated on a scale of 0-100 based on detected patterns:

1.  **Base Weights**:
    -   Cycle: 40 points
    -   Smurfing: 30 points
    -   Shell Chains: 25 points
    -   High Velocity (>5 tx/24h): 10 points
2.  **Interaction Bonuses**: Added when an account exhibits multiple distinct fraud patterns (e.g., +10 for Cycle + Smurfing).
3.  **Structural Confidence**: Adjusts score based on the strength of the ring structure (0.8x to 1.2x multiplier).
4.  **Density Adjustment**: Lowers score for nodes in extremely dense subgraphs (>30% suspicious neighbors) to reduce false positives.
5.  **Percentile Normalization**: Final scores are normalized against the population distribution to ensure meaningful relative ranking.

## Installation & Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/veera-raghav/RIFT26QC.git
    cd RIFT26QC
    ```

2.  **Install dependencies**:
    ```bash
    pip install -r backend/requirements.txt
    ```

3.  **Run the server**:
    ```bash
    python -m backend.main
    # Alternatively: uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
    ```
    The API will be available at `http://localhost:8000`.

## Usage Instructions

### Endpoint: `POST /analyze`
**Request**: `multipart/form-data` with a file field named `file`.

**Input CSV Format**:
```csv
transaction_id,sender_id,receiver_id,amount,timestamp
TX_001,ACC_A,ACC_B,1000.00,2025-01-15 08:00:00
...
```

**Response (JSON)**:
```json
{
  "suspicious_accounts": [ ... ],
  "fraud_rings": [ ... ],
  "summary": { ... },
  "graph_data": { "nodes": [...], "edges": [...] }
}
```
> **Note**: The graph layout is returned in `graph_data` (renamed from `graph`).

### Endpoint: `GET /download-json`
**Description**: Start a direct download of the strict JSON result (without `graph_data`).
**Response**: `analysis_result.json` file download.

## Known Limitations
-   **In-Memory Processing**: The current implementation loads the entire graph into memory. For datasets >100k transactions, a database-backed approach would be required.
-   **Synchronous Processing**: Large files may timeout on standard HTTP connections; async task queues are recommended for production scaling.
-   **Shell Chain Sensitivity**: Shell detection on dense graphs can be aggressive; tuned with strict time/amount constraints to minimize false positives.

## Team Members
-   [Name 1]
-   [Name 2]
-   [Name 3]
