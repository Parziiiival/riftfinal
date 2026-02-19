"""
graph_layout.py — NetworkX Visual Layout Helper

Uses NetworkX ONLY for computing node positions (spring layout)
to send to the frontend for Cytoscape.js rendering.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import networkx as nx

from backend.graph_builder import GraphData


def compute_layout(
    graph: GraphData,
    suspicious_accounts: List[dict],
    fraud_rings: List[dict],
) -> dict:
    """
    Build a NetworkX graph and compute spring layout positions.

    Returns:
        {
          "nodes": [
            {
              "id": "ACC_001",
              "x": 0.42,
              "y": -0.31,
              "suspicious": true,
              "suspicion_score": 87.5,
              "patterns": ["cycle_length_3"],
              "ring_id": "RING_001",
              "in_degree": 3,
              "out_degree": 2,
            }, ...
          ],
          "edges": [
            {
              "source": "ACC_001",
              "target": "ACC_002",
              "amount": 500.0,
              "transaction_id": "TX_001",
            }, ...
          ]
        }
    """
    G = nx.DiGraph()

    # Add all nodes
    for node in graph.all_nodes:
        G.add_node(node)

    # Add edges
    for sender, txs in graph.adj_list.items():
        for tx in txs:
            G.add_edge(tx.sender, tx.receiver, weight=tx.amount)

    # Compute layout
    try:
        # k=2.0 helps spread nodes out
        pos = nx.spring_layout(G, seed=42, k=2.0, iterations=50)
    except Exception:
        # Fallback if spring_layout fails (e.g. missing scipy) or is too slow
        pos = nx.circular_layout(G)

    # Build lookup for suspicious info
    sus_lookup: Dict[str, dict] = {}
    for sa in suspicious_accounts:
        sus_lookup[sa["account_id"]] = sa

    # Build nodes list
    nodes = []
    for node_id in sorted(graph.all_nodes):
        stats = graph.node_stats.get(node_id)
        position = pos.get(node_id, (0, 0))
        sus_info = sus_lookup.get(node_id)

        node_data = {
            "id": node_id,
            "x": round(float(position[0]) * 500, 2),
            "y": round(float(position[1]) * 500, 2),
            "suspicious": sus_info is not None,
            "suspicion_score": sus_info["suspicion_score"] if sus_info else 0,
            "patterns": sus_info["detected_patterns"] if sus_info else [],
            "ring_id": sus_info["ring_id"] if sus_info else None,
            "in_degree": stats.in_degree if stats else 0,
            "out_degree": stats.out_degree if stats else 0,
        }
        nodes.append(node_data)

    # Build deduplicated edges
    seen_edges = set()
    edges = []
    for tx in graph.transactions:
        edge_key = tx.transaction_id
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        edges.append({
            "source": tx.sender,
            "target": tx.receiver,
            "amount": tx.amount,
            "transaction_id": tx.transaction_id,
        })

    return {"nodes": nodes, "edges": edges}
