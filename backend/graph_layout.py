"""
graph_layout.py — Risk-Sectioned Graph Layout

Positions nodes in 3 distinct sections by risk tier:
  - No Risk (score 0): left section
  - Low Risk (0 < score < 70): center section
  - High Risk (score >= 70): right section

Uses sorted bucketing for deterministic placement.
"""

from __future__ import annotations

import math
from typing import Dict, List, Tuple

from backend.graph_builder import GraphData

# Risk tier thresholds (scores 0–100)
NO_RISK_MAX = 0
LOW_RISK_MAX = 69
HIGH_RISK_MIN = 70

# Grid spacing within each section
GRID_CELL = 42
# Minimum gap between sections to prevent overlap
SECTION_GAP = 60


def _risk_tier(score: float) -> str:
    if score <= NO_RISK_MAX:
        return "no_risk"
    if score < HIGH_RISK_MIN:
        return "low_risk"
    return "high_risk"


def _calculate_section_width(n: int) -> float:
    """Calculate the width needed for a section with n nodes."""
    if n == 0:
        return 0
    cols = max(1, int(math.ceil(math.sqrt(n))))
    return cols * GRID_CELL


def _grid_positions(node_ids: List[str], start_x: float, max_width: float) -> List[Tuple[float, float]]:
    """Place nodes in a grid within a section starting at start_x, constrained to max_width."""
    n = len(node_ids)
    if n == 0:
        return []

    # Calculate grid dimensions
    cols = max(1, int(math.ceil(math.sqrt(n))))
    rows = math.ceil(n / cols)
    
    # Ensure grid fits within max_width
    actual_cols = cols
    if cols * GRID_CELL > max_width:
        actual_cols = max(1, int(max_width / GRID_CELL))
        rows = math.ceil(n / actual_cols)
    
    # Grid dimensions
    grid_width = (actual_cols - 1) * GRID_CELL
    grid_height = (rows - 1) * GRID_CELL
    
    # Center the grid vertically, align left at start_x
    start_y = -grid_height / 2

    positions = []
    for i, _ in enumerate(node_ids):
        row, col = divmod(i, actual_cols)
        x = start_x + col * GRID_CELL
        y = start_y + row * GRID_CELL
        positions.append((x, y))

    return positions


def compute_layout(
    graph: GraphData,
    suspicious_accounts: List[dict],
    fraud_rings: List[dict],
) -> dict:
    """
    Build layout with 3 risk sections: No Risk | Low Risk | High Risk.
    """
    sus_lookup: Dict[str, dict] = {sa["account_id"]: sa for sa in suspicious_accounts}

    # Bucket nodes by risk tier (sorted by id for determinism)
    no_risk: List[str] = []
    low_risk: List[str] = []
    high_risk: List[str] = []

    for node_id in sorted(graph.all_nodes):
        sus_info = sus_lookup.get(node_id)
        score = sus_info["suspicion_score"] if sus_info else 0.0
        tier = _risk_tier(score)
        if tier == "no_risk":
            no_risk.append(node_id)
        elif tier == "low_risk":
            low_risk.append(node_id)
        else:
            high_risk.append(node_id)

    # Sort each bucket by score (ascending within section for consistent ordering)
    def key_no_risk(nid: str) -> Tuple[float, str]:
        return (0.0, nid)

    def key_low_risk(nid: str) -> Tuple[float, str]:
        s = sus_lookup.get(nid, {}).get("suspicion_score", 0)
        return (s, nid)

    def key_high_risk(nid: str) -> Tuple[float, str]:
        s = sus_lookup.get(nid, {}).get("suspicion_score", 0)
        return (-s, nid)  # descending by score in high-risk

    no_risk.sort(key=key_no_risk)
    low_risk.sort(key=key_low_risk)
    high_risk.sort(key=key_high_risk)

    # Calculate section widths and positions to ensure no overlap
    no_risk_width = _calculate_section_width(len(no_risk))
    low_risk_width = _calculate_section_width(len(low_risk))
    high_risk_width = _calculate_section_width(len(high_risk))
    
    # Position sections side-by-side with gaps
    # Start from left, place sections with gaps between them
    no_risk_start = -((no_risk_width + low_risk_width + high_risk_width) / 2 + SECTION_GAP * 2)
    low_risk_start = no_risk_start + no_risk_width + SECTION_GAP
    high_risk_start = low_risk_start + low_risk_width + SECTION_GAP
    
    # Assign grid positions per section (each constrained to its width)
    pos_map: Dict[str, Tuple[float, float]] = {}
    for node_id, (x, y) in zip(no_risk, _grid_positions(no_risk, no_risk_start, no_risk_width)):
        pos_map[node_id] = (x, y)
    for node_id, (x, y) in zip(low_risk, _grid_positions(low_risk, low_risk_start, low_risk_width)):
        pos_map[node_id] = (x, y)
    for node_id, (x, y) in zip(high_risk, _grid_positions(high_risk, high_risk_start, high_risk_width)):
        pos_map[node_id] = (x, y)

    # Build nodes list with risk_tier
    nodes = []
    for node_id in sorted(graph.all_nodes):
        stats = graph.node_stats.get(node_id)
        position = pos_map.get(node_id, (0, 0))
        sus_info = sus_lookup.get(node_id)
        score = sus_info["suspicion_score"] if sus_info else 0.0
        tier = _risk_tier(score)

        node_data = {
            "id": node_id,
            "x": round(float(position[0]), 2),
            "y": round(float(position[1]), 2),
            "suspicious": sus_info is not None,
            "suspicion_score": score,
            "patterns": sus_info["detected_patterns"] if sus_info else [],
            "ring_id": sus_info["ring_id"] if sus_info else None,
            "in_degree": stats.in_degree if stats else 0,
            "out_degree": stats.out_degree if stats else 0,
            "risk_tier": tier,
        }
        nodes.append(node_data)

    # Build deduplicated edges
    seen_edges = set()
    edges = []
    for tx in graph.transactions:
        if tx.transaction_id in seen_edges:
            continue
        seen_edges.add(tx.transaction_id)
        edges.append({
            "source": tx.sender,
            "target": tx.receiver,
            "amount": tx.amount,
            "transaction_id": tx.transaction_id,
        })

    return {
        "nodes": nodes,
        "edges": edges,
        "risk_sections": {
            "no_risk": {"count": len(no_risk), "label": "No Risk"},
            "low_risk": {"count": len(low_risk), "label": "Low Risk"},
            "high_risk": {"count": len(high_risk), "label": "High Risk"},
        },
    }
