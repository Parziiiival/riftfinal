"""
main.py — FastAPI Application Entry Point

Single endpoint: POST /analyze
  - Accepts a CSV file upload
  - Runs the full detection pipeline synchronously
  - Returns strict JSON response
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.graph_builder import parse_csv
from backend.cycle_detector import detect_cycles
from backend.smurf_detector import detect_smurfing
from backend.shell_detector import detect_shell_chains
from backend.scoring_engine import run_scoring_pipeline
from backend.graph_layout import compute_layout

app = FastAPI(
    title="Money Muling Detection Engine",
    description="Detects money muling networks using graph-based analysis.",
    version="1.0.0",
)

# ── CORS — allow all origins for dev/demo ─────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "Money Muling Detection Engine"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Accept a CSV upload, run the full fraud detection pipeline,
    and return strict JSON output.
    """
    # ── Validate file type ────────────────────────────────────────
    if file.content_type and "csv" not in file.content_type and "text" not in file.content_type:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Please upload a CSV file.",
        )

    start_time = time.time()

    # ── Read file content ─────────────────────────────────────────
    try:
        raw_bytes = await file.read()
        content = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File encoding must be UTF-8.")

    # ── Step 1: Parse CSV & build graph ───────────────────────────
    try:
        graph = parse_csv(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # ── Step 2: Pattern detection ─────────────────────────────────
    cycle_rings = detect_cycles(graph)
    smurf_rings = detect_smurfing(graph)
    shell_rings = detect_shell_chains(graph)

    # ── Step 3: Scoring pipeline ──────────────────────────────────
    result = run_scoring_pipeline(graph, cycle_rings, smurf_rings, shell_rings)

    # ── Step 4: Compute graph layout for visualization ────────────
    layout = compute_layout(
        graph,
        result["suspicious_accounts"],
        result["fraud_rings"],
    )

    elapsed = round(time.time() - start_time, 2)
    result["summary"]["processing_time_seconds"] = elapsed

    # Remove internal data before sending
    all_rings_internal = result.pop("_all_rings", [])

    # ── Build final response ──────────────────────────────────────
    response: dict[str, Any] = {
        "suspicious_accounts": result["suspicious_accounts"],
        "fraud_rings": result["fraud_rings"],
        "summary": result["summary"],
        "graph": layout,
    }

    return response


# ── Direct run ────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
