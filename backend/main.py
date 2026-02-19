"""
main.py — FastAPI server for the Fraud Detection Pipeline.

Endpoints:
  POST /analyze      — Upload CSV, run full pipeline, return results + graph layout
  GET  /download-json — Return the latest analysis result as JSON
  GET  /health       — Health check
  GET  /account/{id} — Deep-dive data for a single account
  GET  /neo4j/graph  — Typed graph from Neo4j (optional)

Serves the frontend from ../frontend/
"""

from __future__ import annotations

import os
import time

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from backend.graph_builder import parse_csv
from backend.cycle_detector import detect_cycles
from backend.smurf_detector import detect_smurfing
from backend.shell_detector import detect_shell_chains
from backend.scoring_engine import run_scoring_pipeline
from backend.graph_layout import compute_layout
from backend.neo4j_graph import sync_to_neo4j, fetch_graph_from_neo4j

app = FastAPI(title="RIFT Fraud Detection API", version="1.0.0")

# ── CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ──────────────────────────────────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# ── Module-level store for the latest analysis result ─────────────
_last_result: dict | None = None
_last_graph = None


# ── Health ────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    """Serve the frontend index.html."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"status": "ok", "service": "Money Muling Detection Engine"}


# ── Analyze ───────────────────────────────────────────────────────
@app.post("/analyze")
def analyze(file: UploadFile = File(...)):
    """Upload a CSV file and run the full fraud detection pipeline."""
    global _last_result, _last_graph
    try:
        if not file.filename.endswith(".csv"):
            raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

        try:
            raw_bytes = file.file.read()
            try:
                raw = raw_bytes.decode("utf-8-sig")
            except UnicodeDecodeError:
                raw = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            try:
                raw = raw_bytes.decode("latin-1")
            except Exception:
                raise HTTPException(status_code=400, detail="File must be UTF-8 encoded.")

        start = time.time()

        try:
            graph = parse_csv(raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        _last_graph = graph

        cycle_rings = detect_cycles(graph)
        smurf_rings = detect_smurfing(graph)
        shell_rings = detect_shell_chains(graph)

        result = run_scoring_pipeline(graph, cycle_rings, smurf_rings, shell_rings)

        layout = compute_layout(
            graph,
            result["suspicious_accounts"],
            result.get("_all_rings", []),
        )

        tx_timestamp_map = {}
        for tx in graph.transactions:
            tx_timestamp_map[tx.transaction_id] = tx.timestamp.isoformat()

        for edge in layout["edges"]:
            edge["timestamp"] = tx_timestamp_map.get(edge["transaction_id"], "")

        result.pop("_all_rings", None)

        neo4j_synced = False
        try:
            neo4j_synced = sync_to_neo4j(
                graph,
                result["suspicious_accounts"],
                result["fraud_rings"],
            )
        except Exception as e:
            print(f"DEBUG: Neo4j sync skipped: {e}")

        processing_time_seconds = round(time.time() - start, 4)

        response = {
            "graph_data": layout,
            "suspicious_accounts": result["suspicious_accounts"],
            "fraud_rings": result["fraud_rings"],
            "summary": result["summary"],
            "processing_time_seconds": processing_time_seconds,
            "neo4j_synced": neo4j_synced,
        }

        _last_result = response

        return JSONResponse(content=response)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


# ── Account Deep-Dive ─────────────────────────────────────────────
@app.get("/account/{account_id}")
def account_detail(account_id: str):
    """Return deep-dive data for a specific account."""
    if _last_result is None or _last_graph is None:
        raise HTTPException(status_code=404, detail="No analysis has been run yet.")

    graph = _last_graph
    if account_id not in graph.all_nodes:
        raise HTTPException(status_code=404, detail=f"Account '{account_id}' not found.")

    stats = graph.node_stats.get(account_id)

    outgoing = []
    for tx in graph.adj_list.get(account_id, []):
        outgoing.append({
            "transaction_id": tx.transaction_id,
            "to": tx.receiver,
            "amount": tx.amount,
            "timestamp": tx.timestamp.isoformat(),
        })

    incoming = []
    for tx in graph.reverse_adj_list.get(account_id, []):
        incoming.append({
            "transaction_id": tx.transaction_id,
            "from": tx.sender,
            "amount": tx.amount,
            "timestamp": tx.timestamp.isoformat(),
        })

    sus_info = None
    for sa in _last_result.get("suspicious_accounts", []):
        if sa["account_id"] == account_id:
            sus_info = sa
            break

    member_rings = []
    for ring in _last_result.get("fraud_rings", []):
        if account_id in ring["member_accounts"]:
            member_rings.append(ring)

    reasons = []
    if sus_info:
        patterns = sus_info.get("detected_patterns", [])
        for p in patterns:
            if p.startswith("cycle_length_"):
                length = p.split("_")[-1]
                reasons.append(f"Part of a {length}-node circular money loop")
            elif p == "cycle":
                reasons.append("Involved in circular transaction routing")
            elif p == "smurfing":
                reasons.append("Fan-out pattern: distributing funds to many accounts")
            elif p == "shell":
                reasons.append("Shell chain: layered pass-through transactions")

        if len(member_rings) > 1:
            reasons.append(f"Member of {len(member_rings)} fraud rings simultaneously")

        total_tx = len(outgoing) + len(incoming)
        if total_tx > 5:
            reasons.append(f"High transaction velocity: {total_tx} transactions detected")

    return JSONResponse(content={
        "account_id": account_id,
        "suspicion_score": sus_info["suspicion_score"] if sus_info else 0,
        "is_suspicious": sus_info is not None,
        "detected_patterns": sus_info["detected_patterns"] if sus_info else [],
        "reasons": reasons,
        "rings": member_rings,
        "stats": {
            "in_degree": stats.in_degree if stats else 0,
            "out_degree": stats.out_degree if stats else 0,
            "total_in_amount": round(stats.total_in_amount, 2) if stats else 0,
            "total_out_amount": round(stats.total_out_amount, 2) if stats else 0,
        },
        "outgoing_transactions": sorted(outgoing, key=lambda x: x["timestamp"]),
        "incoming_transactions": sorted(incoming, key=lambda x: x["timestamp"]),
    })


# ── Neo4j Graph ────────────────────────────────────────────────────
@app.get("/neo4j/graph")
def neo4j_graph():
    """Return the graph from Neo4j with typed Account nodes (if Neo4j is configured)."""
    data = fetch_graph_from_neo4j()
    if data is None:
        raise HTTPException(
            status_code=503,
            detail="Neo4j not configured (set NEO4J_URI) or no graph data available.",
        )
    return JSONResponse(content=data)


# ── Download JSON ──────────────────────────────────────────────────
@app.get("/download-json")
def download_json():
    """Return the latest analysis result as JSON (no graph_data)."""
    if _last_result is None:
        raise HTTPException(status_code=404, detail="No analysis has been run yet.")

    download_payload = {
        "suspicious_accounts": _last_result["suspicious_accounts"],
        "fraud_rings": _last_result["fraud_rings"],
        "summary": {
            **_last_result["summary"],
            "processing_time_seconds": _last_result["processing_time_seconds"],
        },
    }

    return JSONResponse(
        content=download_payload,
        headers={"Content-Disposition": 'attachment; filename="analysis_result.json"'},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="debug")
