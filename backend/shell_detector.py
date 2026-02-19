"""
shell_detector.py — Layered Shell Chain Detection

Rules:
  - Directed acyclic path of length ≥3
  - Intermediate nodes have degree ∈ [2, 3]
  - No branching in path (each intermediate has exactly 1 out-edge on the path)
  - Depth-limited DFS
  - Structural tightness scoring
"""

from __future__ import annotations

from typing import Dict, List, Set

from backend.graph_builder import GraphData, Transaction

MIN_PATH_LEN = 3
MAX_PATH_LEN = 8  # reasonable upper bound for DFS
INTERMEDIATE_DEGREE_MIN = 2
INTERMEDIATE_DEGREE_MAX = 3


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
    results: List[dict] = []
    seen_paths: Set[tuple] = set()

    # Start from every node
    for start_node in sorted(graph.all_nodes):
        _explore_chains(
            graph=graph,
            path=[start_node],
            tx_path=[],
            results=results,
            seen_paths=seen_paths,
        )

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

    # Record valid chain if long enough
    if depth >= MIN_PATH_LEN:
        chain_key = tuple(path)
        if chain_key not in seen_paths:
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

    # No branching rule: for intermediaries (not the start), outgoing degree
    # on the path should be 1 (we pick the single edge that continues the chain)
    for tx in outgoing:
        neighbour = tx.receiver

        # Acyclic: no revisiting
        if neighbour in path:
            continue

        # Intermediate node constraint (the *current* node is intermediate if
        # it is not the start node)
        if depth > 1:  # current is an intermediate node
            stats = graph.node_stats.get(current)
            if stats is None:
                continue
            if not (INTERMEDIATE_DEGREE_MIN <= stats.total_degree <= INTERMEDIATE_DEGREE_MAX):
                continue

        # Also check the candidate neighbour as potential intermediate
        # (it will become intermediate if the chain extends beyond it)
        neighbour_stats = graph.node_stats.get(neighbour)

        path.append(neighbour)
        tx_path.append(tx)
        _explore_chains(graph, path, tx_path, results, seen_paths)
        tx_path.pop()
        path.pop()


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
