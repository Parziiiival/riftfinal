"""
smurf_detector.py — Smurfing Detection (Fan-in / Fan-out)

Rules:
  - ≥10 distinct counterparties
  - Within a sliding 72-hour window
  - Diversity score: unique_counterparties / total_transactions
    → if >0.7 → dampen suspicion
  - Variance guard: std(amounts) / mean(amounts)
    → if >0.5 → reduce smurf score by 30 %
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta
from typing import Dict, List, Set

from backend.graph_builder import GraphData, Transaction

MIN_COUNTERPARTIES = 10
WINDOW_HOURS = 72
DIVERSITY_THRESHOLD = 0.7
VARIANCE_THRESHOLD = 0.5
VARIANCE_DAMPEN = 0.70  # multiply score by this when variance > threshold


def detect_smurfing(graph: GraphData) -> List[dict]:
    """
    Identify accounts exhibiting smurfing behaviour (fan-in or fan-out).

    Returns list of ring dicts:
        {
          "pattern_type": "smurfing",
          "members": [hub_account, counterparty_1, …],
          "hub": hub_account_id,
          "direction": "fan_out" | "fan_in",
          "counterparty_count": int,
          "diversity_score": float,
          "variance_ratio": float,
          "dampened": bool,
        }
    """
    results: List[dict] = []
    checked: Set[str] = set()

    for node in sorted(graph.all_nodes):
        if node in checked:
            continue

        # ── Fan-out (node → many) ──
        out_txs = graph.adj_list.get(node, [])
        fan_out_result = _check_fan(node, out_txs, direction="fan_out")
        if fan_out_result:
            results.append(fan_out_result)

        # ── Fan-in (many → node) ──
        in_txs = graph.reverse_adj_list.get(node, [])
        fan_in_result = _check_fan(node, in_txs, direction="fan_in")
        if fan_in_result:
            results.append(fan_in_result)

        checked.add(node)

    return results


# ── Private helpers ───────────────────────────────────────────────

def _check_fan(
    hub: str,
    txs: List[Transaction],
    direction: str,
) -> dict | None:
    """Check if a hub account's transactions meet the smurfing criteria."""
    if len(txs) < MIN_COUNTERPARTIES:
        return None

    # Sort by timestamp for sliding window
    sorted_txs = sorted(txs, key=lambda t: t.timestamp)

    best_window = _best_sliding_window(sorted_txs, direction)
    if best_window is None:
        return None

    window_txs, counterparties = best_window

    # Diversity score
    diversity = len(counterparties) / len(window_txs) if window_txs else 0.0

    # Variance ratio
    amounts = [tx.amount for tx in window_txs]
    variance_ratio = _variance_ratio(amounts)

    dampened = False
    # Diversity dampening
    if diversity > DIVERSITY_THRESHOLD:
        dampened = True

    # Variance dampening
    if variance_ratio > VARIANCE_THRESHOLD:
        dampened = True

    members = [hub] + sorted(counterparties)

    return {
        "pattern_type": "smurfing",
        "members": members,
        "hub": hub,
        "direction": direction,
        "counterparty_count": len(counterparties),
        "diversity_score": round(diversity, 4),
        "variance_ratio": round(variance_ratio, 4),
        "dampened": dampened,
        "transactions": window_txs,
    }


def _best_sliding_window(
    sorted_txs: List[Transaction],
    direction: str,
) -> tuple | None:
    """
    Find the 72-hour window with the most distinct counterparties.
    Uses a two-pointer sliding window ($O(N)$) for efficiency.
    Returns (window_txs, counterparties) or None.
    """
    if not sorted_txs:
        return None

    window_delta = timedelta(hours=WINDOW_HOURS)
    best_txs = None
    best_counterparties: Set[str] = set()

    n = len(sorted_txs)
    right = 0
    # Track counterparties in the current window and their counts
    current_cp_counts: Dict[str, int] = defaultdict(int)

    for left in range(n):
        # Expand right boundary
        while right < n and (sorted_txs[right].timestamp - sorted_txs[left].timestamp) <= window_delta:
            cp = sorted_txs[right].receiver if direction == "fan_out" else sorted_txs[right].sender
            current_cp_counts[cp] += 1
            right += 1

        # Check if current window is the best
        if len(current_cp_counts) >= MIN_COUNTERPARTIES:
            if len(current_cp_counts) > len(best_counterparties):
                best_txs = sorted_txs[left:right]
                best_counterparties = set(current_cp_counts.keys())

        # Shrink left boundary: remove left-most transaction
        cp_left = sorted_txs[left].receiver if direction == "fan_out" else sorted_txs[left].sender
        current_cp_counts[cp_left] -= 1
        if current_cp_counts[cp_left] == 0:
            del current_cp_counts[cp_left]

    if best_txs is None:
        return None
    return best_txs, best_counterparties



def _variance_ratio(amounts: List[float]) -> float:
    """std(amounts) / mean(amounts), guarded against div-by-zero."""
    if not amounts or len(amounts) < 2:
        return 0.0
    mean = sum(amounts) / len(amounts)
    if mean == 0:
        return 0.0
    variance = sum((a - mean) ** 2 for a in amounts) / len(amounts)
    std = math.sqrt(variance)
    return std / mean
