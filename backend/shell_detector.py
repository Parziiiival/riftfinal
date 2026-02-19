"""
shell_detector.py — Layered Shell Chain Detection

Rules:
  - Directed acyclic path of length ≥3
  - Intermediate nodes have degree ∈ [2, 3]
  - No branching in path (each intermediate has exactly 1 out-edge on the path)
  - Time constraint: chain must complete within 72 hours
  - Amount consistency: max/min amount ratio ≤ 3.0
  - Minimum transaction amount ≥ 100
  - Post-processing: only keep maximal chains (prune sub-chains)
  - Depth-limited DFS
  - Structural tightness scoring
"""

from __future__ import annotations

from datetime import timedelta
from typing import Dict, List, Set, Tuple

from backend.graph_builder import GraphData, Transaction

MIN_PATH_LEN = 3
MAX_PATH_LEN = 8  # reasonable upper bound for DFS
INTERMEDIATE_DEGREE_MIN = 2
INTERMEDIATE_DEGREE_MAX = 3
MAX_TIME_SPAN_HOURS = 72
MAX_AMOUNT_RATIO = 3.0
MIN_TRANSACTION_AMOUNT = 100.0


def detect_shell_chains(graph: GraphData) -> List[dict]:
    """
    Find directed acyclic paths where intermediaries have constrained degree.

    Returns list of ring dicts:
        {
          "pattern_type": "shell",
          "members": [node_ids along the chain],
          "transactions": [Transaction…],
          "path_length": int,
          "tightness_score": float,
        }
    """
    raw_results: List[dict] = []
    seen_paths: Set[tuple] = set()

    # Start from every node
    for start_node in sorted(graph.all_nodes):
        _explore_chains(
            graph=graph,
            path=[start_node],
            tx_path=[],
            results=raw_results,
            seen_paths=seen_paths,
        )

    # Post-process: keep only maximal chains
    results = _keep_maximal_chains(raw_results)

    return results


def _explore_chains(
    graph: GraphData,
    path: List[str],
    tx_path: List[Transaction],
    results: List[dict],
    seen_paths: Set[tuple],
) -> None:
    """DFS to build acyclic chains with constrained intermediate degrees."""
    current = path[-1]
    depth = len(path)

    # Record valid chain if long enough and passes all constraints
    if depth >= MIN_PATH_LEN:
        chain_key = tuple(path)
        if chain_key not in seen_paths:
            if _validate_chain(tx_path):
                seen_paths.add(chain_key)
                tightness = _compute_tightness(graph, path)
                results.append({
                    "pattern_type": "shell",
                    "members": list(path),
                    "transactions": list(tx_path),
                    "path_length": len(path),
                    "tightness_score": round(tightness, 4),
                })

    if depth >= MAX_PATH_LEN:
        return

    # Extend
    outgoing = graph.adj_list.get(current, [])

    for tx in outgoing:
        neighbour = tx.receiver

        # Acyclic: no revisiting
        if neighbour in path:
            continue

        # Minimum amount filter
        if tx.amount < MIN_TRANSACTION_AMOUNT:
            continue

        # Intermediate node constraint (the *current* node is intermediate if
        # it is not the start node)
        if depth > 1:  # current is an intermediate node
            stats = graph.node_stats.get(current)
            if stats is None:
                continue
            if not (INTERMEDIATE_DEGREE_MIN <= stats.total_degree <= INTERMEDIATE_DEGREE_MAX):
                continue

        # Early time pruning
        candidate_txs = tx_path + [tx]
        if _time_span_hours(candidate_txs) > MAX_TIME_SPAN_HOURS:
            continue

        path.append(neighbour)
        tx_path.append(tx)
        _explore_chains(graph, path, tx_path, results, seen_paths)
        tx_path.pop()
        path.pop()


def _validate_chain(txs: List[Transaction]) -> bool:
    """Check time span ≤72h and amount ratio ≤3.0."""
    if not txs:
        return False
    if _time_span_hours(txs) > MAX_TIME_SPAN_HOURS:
        return False
    amounts = [tx.amount for tx in txs]
    min_a = min(amounts)
    if min_a <= 0:
        return False
    if max(amounts) / min_a > MAX_AMOUNT_RATIO:
        return False
    return True


def _time_span_hours(txs: List[Transaction]) -> float:
    """Total time span of the transaction list in hours."""
    if not txs:
        return 0.0
    timestamps = [tx.timestamp for tx in txs]
    span = max(timestamps) - min(timestamps)
    return span.total_seconds() / 3600.0


def _keep_maximal_chains(chains: List[dict]) -> List[dict]:
    """
    Remove sub-chains: if chain A's members are a contiguous subset
    of chain B's members, discard A.
    Uses a hash set for $O(C)$ complexity instead of $O(C^2)$.
    """
    if not chains:
        return []

    # Sort by path length descending so we process longest first
    chains.sort(key=lambda c: -c["path_length"])

    keep = []
    covered_subsequences: Set[Tuple[str, ...]] = set()

    for chain in chains:
        members = tuple(chain["members"])
        if members in covered_subsequences:
            # This chain is already a sub-chain of a previously kept (longer) chain
            continue

        # Keep this chain
        keep.append(chain)

        # Add all contiguous subsequences of this chain to the covered set
        # Chain max length is 5, so n(n+1)/2 = 15 subsequences per chain
        n = len(members)
        for length in range(2, n + 1):
            for start in range(n - length + 1):
                sub = members[start:start + length]
                covered_subsequences.add(sub)

    return keep



def _is_contiguous_subseq(longer: tuple, shorter: tuple) -> bool:
    """Check if shorter is a contiguous subsequence of longer."""
    len_s = len(shorter)
    len_l = len(longer)
    if len_s > len_l:
        return False
    for start in range(len_l - len_s + 1):
        if longer[start:start + len_s] == shorter:
            return True
    return False


def _compute_tightness(graph: GraphData, path: List[str]) -> float:
    """
    Structural tightness score = 1 / avg(intermediate_degree).
    Intermediate nodes are all nodes except the first and last.
    """
    intermediates = path[1:-1]
    if not intermediates:
        return 1.0

    total_degree = 0
    for node in intermediates:
        stats = graph.node_stats.get(node)
        if stats:
            total_degree += stats.total_degree
        else:
            total_degree += 1  # fallback

    avg_degree = total_degree / len(intermediates)
    if avg_degree == 0:
        return 1.0
    return 1.0 / avg_degree
