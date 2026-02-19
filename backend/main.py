"""
main.py — FastAPI Application Entry Point

Endpoints:
  POST /analyze   — Accept CSV, process synchronously, return full result
  GET  /download-json — Return exact required JSON only (no graph data)

Track: processing_time_seconds
No async.  No background jobs.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

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

# ── Serve frontend static files ───────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_FRONTEND_DIR = _PROJECT_ROOT / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static")

# ── In-memory cache for the latest analysis (strict JSON only) ────
_last_download_json: Optional[dict] = None


@app.get("/")
def serve_index():
    """Serve the frontend index.html."""
    index_file = _FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file), media_type="text/html")
    return {"status": "ok", "service": "Money Muling Detection Engine"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Accept a CSV upload, run the full fraud detection pipeline,
    and return strict JSON output.
    """
    global _last_download_json

    # ── Validate file type ────────────────────────────────────────
    filename = (file.filename or "").lower()
    ct = (file.content_type or "").lower()
    is_csv = (
        filename.endswith(".csv")
        or "csv" in ct
        or "text" in ct
        or "excel" in ct
        or "octet-stream" in ct
    )
    if not is_csv:
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
    try:
        layout = compute_layout(
            graph,
            result["suspicious_accounts"],
            result["fraud_rings"],
        )
    except Exception as e:
        print(f"Layout computation failed: {e}")
        # Fallback: empty graph data to prevent 500 error
        layout = {"nodes": [], "edges": []}

    elapsed = round(time.time() - start_time, 2)
    result["summary"]["processing_time_seconds"] = elapsed

    # Remove internal data before sending
    result.pop("_all_rings", [])

    # ── Cache the strict download JSON (no graph_data) ────────────
    _last_download_json = {
        "suspicious_accounts": result["suspicious_accounts"],
        "fraud_rings": result["fraud_rings"],
        "summary": result["summary"],
    }

    # ── Build final response (includes graph_data for frontend) ───
    response: dict[str, Any] = {
        "suspicious_accounts": result["suspicious_accounts"],
        "fraud_rings": result["fraud_rings"],
        "summary": result["summary"],
        "graph_data": layout,
    }

    return response


@app.get("/download-json")
def download_json():
    """
    Return exact required JSON only — no graph_data.
    Uses the result from the most recent POST /analyze call.
    """
    if _last_download_json is None:
        raise HTTPException(
            status_code=404,
            detail="No analysis has been run yet. Upload a CSV via POST /analyze first.",
        )
    return JSONResponse(
        content=_last_download_json,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=analysis_result.json"},
    )


# ── Direct run ────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
