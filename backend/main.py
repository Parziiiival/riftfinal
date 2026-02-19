"""
main.py — FastAPI server for the Fraud Detection Pipeline.

Endpoints:
  POST /analyze      — Upload CSV, run full pipeline, return results + graph layout
  GET  /download-json — Return the latest analysis result as JSON
  GET  /health       — Health check

Serves the frontend from ../frontend/
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.graph_builder import parse_csv
from backend.cycle_detector import detect_cycles
from backend.smurf_detector import detect_smurfing
from backend.shell_detector import detect_shell_chains
from backend.scoring_engine import run_scoring_pipeline
from backend.graph_layout import compute_layout

app = FastAPI(title="RIFT Fraud Detection API", version="1.0.0")

# ── CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Module-level store for the latest analysis result ─────────────
_last_result: dict | None = None


# ── Health ────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ── Analyze ───────────────────────────────────────────────────────
@app.post("/analyze")
def analyze(file: UploadFile = File(...)):
    """Upload a CSV file and run the full fraud detection pipeline."""
    global _last_result

    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    try:
        raw = file.file.read().decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded.")

    start = time.time()

    # ── Parse ──
    try:
        graph = parse_csv(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── Detect patterns ──
    cycle_rings = detect_cycles(graph)
    smurf_rings = detect_smurfing(graph)
    shell_rings = detect_shell_chains(graph)

    # ── Score ──
    result = run_scoring_pipeline(graph, cycle_rings, smurf_rings, shell_rings)

    # ── Layout ──
    layout = compute_layout(
        graph,
        result["suspicious_accounts"],
        result.get("_all_rings", []),
    )

    # Strip internal fields
    result.pop("_all_rings", None)

    processing_time_seconds = round(time.time() - start, 4)

    response = {
        "graph_data": layout,
        "suspicious_accounts": result["suspicious_accounts"],
        "fraud_rings": result["fraud_rings"],
        "summary": result["summary"],
        "processing_time_seconds": processing_time_seconds,
    }

    # Store for /download-json
    _last_result = response

    return JSONResponse(content=response)


# ── Download JSON ─────────────────────────────────────────────────
@app.get("/download-json")
def download_json():
    """Return the exact required JSON only (no graph_data)."""
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
        headers={
            "Content-Disposition": 'attachment; filename="analysis_result.json"'
        },
    )


# ── Serve frontend static files ──────────────────────────────────
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

if FRONTEND_DIR.is_dir():
    from starlette.responses import FileResponse

    @app.get("/")
    def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
