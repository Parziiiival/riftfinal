"""
confidence_engine.py — Structural Confidence Engine

For each ring, computes:
  - temporal_score  = max(0, 1 - (time_span / 72))
  - amount_score    = max(0, 1 - (ratio - 1))
  - tightness_score = 1 / avg(intermediate_degree)

structural_confidence = 0.4 * temporal_score
                      + 0.3 * amount_score
                      + 0.3 * tightness_score

Clamped to [0, 1].
"""

from __future__ import annotations

from datetime import timedelta
from typing import Dict, List

from backend.graph_builder import GraphData, Transaction

MAX_TIME_SPAN_HOURS = 72.0


def compute_structural_confidence(
    ring: dict,
    graph: GraphData,
) -> float:
    """
    Compute structural_confidence ∈ [0, 1] for a detected ring/pattern.
    """
    temporal = _temporal_score(ring)
    amount = _amount_score(ring)
    tightness = _tightness_score(ring, graph)

    confidence = 0.4 * temporal + 0.3 * amount + 0.3 * tightness
    return round(max(0.0, min(1.0, confidence)), 4)


# ── Sub-scores ────────────────────────────────────────────────────

def _temporal_score(ring: dict) -> float:
    """max(0, 1 - (time_span_hours / 72))."""
    txs: List[Transaction] = ring.get("transactions", [])
    if not txs:
        return 1.0
    timestamps = [tx.timestamp for tx in txs]
    span_hours = (max(timestamps) - min(timestamps)).total_seconds() / 3600.0
    return max(0.0, 1.0 - (span_hours / MAX_TIME_SPAN_HOURS))


def _amount_score(ring: dict) -> float:
    """max(0, 1 - (amount_ratio - 1))."""
    # For cycles, we store amount_ratio directly
    if "amount_ratio" in ring:
        ratio = ring["amount_ratio"]
    else:
        txs: List[Transaction] = ring.get("transactions", [])
        if not txs:
            return 1.0
        amounts = [tx.amount for tx in txs]
        min_a = min(amounts)
        if min_a == 0:
            return 0.0
        ratio = max(amounts) / min_a
    return max(0.0, 1.0 - (ratio - 1.0))


def _tightness_score(ring: dict, graph: GraphData) -> float:
    """1 / avg(intermediate_degree). Uses stored value if present."""
    if "tightness_score" in ring:
        return ring["tightness_score"]

    members = ring.get("members", [])
    if len(members) <= 2:
        return 1.0

    intermediates = members[1:-1]
    if not intermediates:
        return 1.0

    total_deg = 0
    for node in intermediates:
        stats = graph.node_stats.get(node)
        total_deg += stats.total_degree if stats else 1

    avg_deg = total_deg / len(intermediates)
    if avg_deg == 0:
        return 1.0
    return min(1.0, 1.0 / avg_deg)
