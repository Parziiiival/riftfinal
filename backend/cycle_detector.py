"""
cycle_detector.py — Cycle Detection (Circular Routing)

Algorithm:
  - Custom bounded DFS, depth 3–5
  - Time constraint: span ≤72 hours
  - Amount ratio check: max/min ≤1.25
  - Canonicalization: rotate cycle to start at lexicographically smallest node
  - Deduplication of canonical cycles
  - Returns structured ring objects
"""

from __future__ import annotations

from datetime import timedelta
from typing import Dict, List, Set, Tuple

from backend.graph_builder import GraphData, Transaction

MAX_CYCLE_LEN = 5
MIN_CYCLE_LEN = 3
MAX_TIME_SPAN_HOURS = 72
MAX_AMOUNT_RATIO = 1.25


def detect_cycles(graph: GraphData) -> List[dict]:
    """
    Find all directed cycles of length 3–5 satisfying time/amount constraints.

    Returns list of ring dicts:
        {
          "pattern_type": "cycle",
          "members": [node_ids…],
          "transactions": [Transaction…],
          "cycle_length": int,
          "time_span_hours": float,
          "amount_ratio": float,
        }
    """
    seen_canonical: Set[tuple] = set()
    results: List[dict] = []

    for start_node in sorted(graph.adj_list.keys()):
        _dfs(
            graph=graph,
            path=[start_node],
            tx_path=[],
            start=start_node,
            seen_canonical=seen_canonical,
            results=results,
        )

    return results


# ── Private helpers ───────────────────────────────────────────────

def _dfs(
    graph: GraphData,
    path: List[str],
    tx_path: List[Transaction],
    start: str,
    seen_canonical: Set[tuple],
    results: List[dict],
) -> None:
    """Bounded DFS up to depth MAX_CYCLE_LEN."""
    current = path[-1]
    depth = len(path)

    if depth > MAX_CYCLE_LEN:
        return

    for tx in graph.adj_list.get(current, []):
        neighbour = tx.receiver

        # ── Cycle found? ──
        if neighbour == start and depth >= MIN_CYCLE_LEN:
            candidate_txs = tx_path + [tx]
            if _validate_cycle(candidate_txs):
                canon = _canonicalize(path)
                if canon not in seen_canonical:
                    seen_canonical.add(canon)
                    time_span = _time_span_hours(candidate_txs)
                    ratio = _amount_ratio(candidate_txs)
                    results.append({
                        "pattern_type": "cycle",
                        "members": list(path),
                        "transactions": candidate_txs,
                        "cycle_length": len(path),
                        "time_span_hours": round(time_span, 2),
                        "amount_ratio": round(ratio, 4),
                    })
            continue

        # ── Extend path (no revisiting) ──
        if neighbour not in path and depth < MAX_CYCLE_LEN:
            # Early pruning: check time so far
            candidate_txs = tx_path + [tx]
            if _time_span_hours(candidate_txs) <= MAX_TIME_SPAN_HOURS:
                path.append(neighbour)
                tx_path.append(tx)
                _dfs(graph, path, tx_path, start, seen_canonical, results)
                tx_path.pop()
                path.pop()


def _validate_cycle(txs: List[Transaction]) -> bool:
    """Check time span ≤72h and amount ratio ≤1.25."""
    if _time_span_hours(txs) > MAX_TIME_SPAN_HOURS:
        return False
    if _amount_ratio(txs) > MAX_AMOUNT_RATIO:
        return False
    return True


def _time_span_hours(txs: List[Transaction]) -> float:
    """Total time span of the transaction list in hours."""
    if not txs:
        return 0.0
    timestamps = [tx.timestamp for tx in txs]
    span = max(timestamps) - min(timestamps)
    return span.total_seconds() / 3600.0


def _amount_ratio(txs: List[Transaction]) -> float:
    """max(amount) / min(amount) across the transactions."""
    amounts = [tx.amount for tx in txs]
    if not amounts:
        return 0.0
    min_a = min(amounts)
    if min_a == 0:
        return float("inf")
    return max(amounts) / min_a


def _canonicalize(path: List[str]) -> tuple:
    """Rotate cycle so it starts at the lexicographically smallest node."""
    min_idx = path.index(min(path))
    rotated = path[min_idx:] + path[:min_idx]
    return tuple(rotated)
