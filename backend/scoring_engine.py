"""
scoring_engine.py — Suspicion Scoring & Ring Management

Pipeline:
  1. Compute base weights per pattern
  2. Add interaction bonus for multi-pattern accounts
  3. Apply structural confidence adjustment
  4. Apply density adjustment
  5. Percentile normalization (clamped [0.85, 1.15])
  6. Cap at 100
  7. Sort descending

⚠ Ensure deterministic ordering.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta
from typing import Dict, List, Set, Tuple

from backend.graph_builder import GraphData, Transaction
from backend.confidence_engine import compute_structural_confidence
from backend.density_guard import compute_density_adjustments

# ── Base weights ──────────────────────────────────────────────────
WEIGHT_CYCLE = 40
WEIGHT_SMURF = 30
WEIGHT_SHELL = 25
WEIGHT_VELOCITY = 10  # >5 tx in 24h

INTERACTION_BONUS_CYCLE_SMURF = 10
INTERACTION_BONUS_CYCLE_SHELL = 8
INTERACTION_BONUS_PER_PATTERN = 10


def run_scoring_pipeline(
    graph: GraphData,
    cycle_rings: List[dict],
    smurf_rings: List[dict],
    shell_rings: List[dict],
) -> dict:
    """
    Full scoring pipeline → strict JSON output.

    Returns:
        {
          "suspicious_accounts": [...],
          "fraud_rings": [...],
          "summary": {...},
        }
    """
    # ── 1. Map accounts → patterns & rings ────────────────────────
    account_patterns: Dict[str, Set[str]] = defaultdict(set)
    account_rings: Dict[str, List[str]] = defaultdict(list)
    all_rings: List[dict] = []
    ring_counter = 0

    # Process each ring type
    for ring in cycle_rings:
        ring_counter += 1
        ring_id = f"RING_{ring_counter:03d}"
        ring["ring_id"] = ring_id
        ring["structural_confidence"] = compute_structural_confidence(ring, graph)
        all_rings.append(ring)
        for member in ring["members"]:
            account_patterns[member].add("cycle")
            label = f"cycle_length_{ring['cycle_length']}"
            if label not in account_patterns[member]:
                account_patterns[member].add(label)
            account_rings[member].append(ring_id)

    for ring in smurf_rings:
        ring_counter += 1
        ring_id = f"RING_{ring_counter:03d}"
        ring["ring_id"] = ring_id
        ring["structural_confidence"] = compute_structural_confidence(ring, graph)
        all_rings.append(ring)
        for member in ring["members"]:
            account_patterns[member].add("smurfing")
            account_rings[member].append(ring_id)

    for ring in shell_rings:
        ring_counter += 1
        ring_id = f"RING_{ring_counter:03d}"
        ring["ring_id"] = ring_id
        ring["structural_confidence"] = compute_structural_confidence(ring, graph)
        all_rings.append(ring)
        for member in ring["members"]:
            account_patterns[member].add("shell")
            account_rings[member].append(ring_id)

    suspicious_set = set(account_patterns.keys())
    if not suspicious_set:
        return _empty_result(graph)

    # ── 2. Velocity check ─────────────────────────────────────────
    velocity_accounts = _velocity_check(graph)

    # ── 3. Base scores ────────────────────────────────────────────
    raw_scores: Dict[str, float] = {}
    for account in suspicious_set:
        patterns = account_patterns[account]
        score = 0.0
        if "cycle" in patterns or any(p.startswith("cycle_length_") for p in patterns):
            score += WEIGHT_CYCLE
        if "smurfing" in patterns:
            score += WEIGHT_SMURF
        if "shell" in patterns:
            score += WEIGHT_SHELL
        if account in velocity_accounts:
            score += WEIGHT_VELOCITY

        # Interaction bonus
        distinct_types = set()
        for p in patterns:
            if p.startswith("cycle"):
                distinct_types.add("cycle")
            elif p == "smurfing":
                distinct_types.add("smurfing")
            elif p == "shell":
                distinct_types.add("shell")

        if len(distinct_types) > 1:
            score += INTERACTION_BONUS_PER_PATTERN * len(distinct_types)
        if "cycle" in distinct_types and "smurfing" in distinct_types:
            score += INTERACTION_BONUS_CYCLE_SMURF
        if "cycle" in distinct_types and "shell" in distinct_types:
            score += INTERACTION_BONUS_CYCLE_SHELL

        raw_scores[account] = score

    # ── 4. Structural confidence adjustment ───────────────────────
    # Average structural confidence across all rings the account belongs to
    account_confidence: Dict[str, float] = {}
    for account in suspicious_set:
        ring_ids = account_rings.get(account, [])
        confidences = []
        for r in all_rings:
            if r["ring_id"] in ring_ids:
                confidences.append(r.get("structural_confidence", 0.5))
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.5
        account_confidence[account] = avg_conf

    for account in suspicious_set:
        conf = account_confidence[account]
        raw_scores[account] *= (0.8 + 0.4 * conf)

    # ── 5. Density adjustment ─────────────────────────────────────
    density_adj = compute_density_adjustments(suspicious_set, graph)
    for account in suspicious_set:
        raw_scores[account] *= density_adj.get(account, 1.0)

    # ── 6. Percentile normalization ───────────────────────────────
    sorted_scores = sorted(raw_scores.values())
    n = len(sorted_scores)

    import bisect
    final_scores: Dict[str, float] = {}
    for account in suspicious_set:
        score = raw_scores[account]
        # Percentile = fraction of accounts with score <= this score
        # Use bisect_right for O(log M) instead of linear scan
        rank = bisect.bisect_right(sorted_scores, score)
        percentile = rank / n if n > 0 else 0.5
        multiplier = max(0.85, min(1.15, 0.85 + 0.3 * percentile))
        final_scores[account] = min(100.0, round(score * multiplier, 1))


    # ── 7. Build output ───────────────────────────────────────────
    # Suspicious accounts — sorted descending by score, then by id for determinism
    suspicious_accounts = []
    for account in sorted(
        suspicious_set,
        key=lambda a: (-final_scores[a], a),
    ):
        detected = sorted(account_patterns[account])
        ring_id_list = sorted(set(account_rings.get(account, [])))
        primary_ring = ring_id_list[0] if ring_id_list else ""
        suspicious_accounts.append({
            "account_id": account,
            "suspicion_score": final_scores[account],
            "detected_patterns": detected,
            "ring_id": primary_ring,
        })

    # Fraud rings — compute ring risk score, sort descending
    fraud_rings = []
    for ring in all_rings:
        member_raw = [raw_scores.get(m, 0) for m in ring["members"]]
        mean_raw = sum(member_raw) / len(member_raw) if member_raw else 0
        ring_risk = round(
            min(100.0, mean_raw * ring.get("structural_confidence", 0.5)),
            1,
        )
        fraud_rings.append({
            "ring_id": ring["ring_id"],
            "member_accounts": sorted(ring["members"]),
            "pattern_type": ring["pattern_type"],
            "risk_score": ring_risk,
        })

    fraud_rings.sort(key=lambda r: (-r["risk_score"], r["ring_id"]))

    return {
        "suspicious_accounts": suspicious_accounts,
        "fraud_rings": fraud_rings,
        "summary": {
            "total_accounts_analyzed": len(graph.all_nodes),
            "suspicious_accounts_flagged": len(suspicious_accounts),
            "fraud_rings_detected": len(fraud_rings),
        },
        # Internal — used by frontend for graph positions
        "_all_rings": all_rings,
    }


# ── Helpers ───────────────────────────────────────────────────────

def _velocity_check(graph: GraphData) -> Set[str]:
    """Accounts with >5 transactions in any 24-hour window."""
    velocity_accounts: Set[str] = set()
    window_delta = timedelta(hours=24)

    for node in graph.all_nodes:
        # Combine incoming and outgoing transactions
        txs = graph.adj_list.get(node, []) + graph.reverse_adj_list.get(node, [])
        if len(txs) <= 5:
            continue

        timestamps = sorted(tx.timestamp for tx in txs)
        n_tx = len(timestamps)
        
        # Two-pointer sliding window
        right = 0
        for left in range(n_tx):
            # Expand right pointer as long as it's within 24h of the left pointer
            while right < n_tx and (timestamps[right] - timestamps[left]) <= window_delta:
                right += 1
            
            # If the current window [left, right) has > 5 transactions, flag and move to next node
            if (right - left) > 5:
                velocity_accounts.add(node)
                break

    return velocity_accounts



def _empty_result(graph: GraphData) -> dict:
    return {
        "suspicious_accounts": [],
        "fraud_rings": [],
        "summary": {
            "total_accounts_analyzed": len(graph.all_nodes),
            "suspicious_accounts_flagged": 0,
            "fraud_rings_detected": 0,
        },
        "_all_rings": [],
    }
