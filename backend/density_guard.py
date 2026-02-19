"""
density_guard.py — Anomaly Density Guard

After suspicious accounts are identified:
  density = suspicious_neighbors / total_neighbors

If density < 0.3  →  multiply score by 0.8 (adjusted down).
Must be computed after all rings are formed.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, Set

from backend.graph_builder import GraphData

DENSITY_THRESHOLD = 0.3
DENSITY_MULTIPLIER = 0.8


def compute_density_adjustments(
    suspicious_accounts: Set[str],
    graph: GraphData,
) -> Dict[str, float]:
    """
    Return a dict  { account_id → density_multiplier }.
    Multiplier is 0.8 when local anomaly density < 0.3, else 1.0.
    """
    adjustments: Dict[str, float] = {}

    for account in suspicious_accounts:
        neighbors: Set[str] = set()

        # Outgoing neighbors
        for tx in graph.adj_list.get(account, []):
            neighbors.add(tx.receiver)

        # Incoming neighbors
        for tx in graph.reverse_adj_list.get(account, []):
            neighbors.add(tx.sender)

        if not neighbors:
            adjustments[account] = DENSITY_MULTIPLIER
            continue

        suspicious_neighbors = len(neighbors & suspicious_accounts)
        total_neighbors = len(neighbors)
        density = suspicious_neighbors / total_neighbors

        if density < DENSITY_THRESHOLD:
            adjustments[account] = DENSITY_MULTIPLIER
        else:
            adjustments[account] = 1.0

    return adjustments
