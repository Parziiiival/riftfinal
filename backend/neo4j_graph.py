"""
neo4j_graph.py — Neo4j Graph Representation of Accounts

Pushes the transaction graph and analysis results to Neo4j for a clean graph model:
  - Account nodes with type labels (Legitimate, CycleParticipant, SmurfingHub, ShellNode, MultiPattern)
  - SENT_TO relationships with amount, timestamp, transaction_id
  - Optional: fraud ring membership as RING_MEMBER relationships

Set NEO4J_URI (e.g. neo4j://localhost:7687) to enable. If unset, sync is skipped.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional

from backend.graph_builder import GraphData, Transaction


# ── Account type labels (Neo4j labels) ─────────────────────────────
# Derived from detected_patterns for clean graph representation
LABEL_ACCOUNT = "Account"
LABEL_LEGITIMATE = "Legitimate"
LABEL_CYCLE = "CycleParticipant"
LABEL_SMURFING = "SmurfingHub"
LABEL_SHELL = "ShellNode"
LABEL_MULTI = "MultiPattern"  # Has 2+ fraud pattern types
LABEL_SUSPICIOUS = "Suspicious"


def _get_account_labels(patterns: List[str], suspicion_score: float) -> List[str]:
    """Map detection patterns to Neo4j labels for typed account representation."""
    labels = [LABEL_ACCOUNT]
    if not patterns or suspicion_score <= 0:
        labels.append(LABEL_LEGITIMATE)
        return labels

    labels.append(LABEL_SUSPICIOUS)
    has_cycle = any(p == "cycle" or p.startswith("cycle_length_") for p in patterns)
    has_smurf = "smurfing" in patterns
    has_shell = "shell" in patterns

    if has_cycle:
        labels.append(LABEL_CYCLE)
    if has_smurf:
        labels.append(LABEL_SMURFING)
    if has_shell:
        labels.append(LABEL_SHELL)
    if sum([has_cycle, has_smurf, has_shell]) >= 2:
        labels.append(LABEL_MULTI)

    return labels


def _build_suspicion_lookup(suspicious_accounts: List[dict]) -> Dict[str, dict]:
    return {sa["account_id"]: sa for sa in suspicious_accounts}


def sync_to_neo4j(
    graph: GraphData,
    suspicious_accounts: List[dict],
    fraud_rings: List[dict],
) -> bool:
    """
    Push graph and analysis results to Neo4j. Creates typed Account nodes
    and SENT_TO relationships.

    Returns True if sync succeeded, False if Neo4j is not configured or an error occurred.
    """
    uri = os.environ.get("NEO4J_URI", "").strip()
    if not uri:
        return False

    try:
        from neo4j import GraphDatabase
    except ImportError:
        return False

    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "password")

    sus_lookup = _build_suspicion_lookup(suspicious_accounts)

    def _run_tx(tx):
        # Clear previous analysis for this session
        tx.run("MATCH (a:Account) DETACH DELETE a")
        tx.run("MATCH (r:FraudRing) DETACH DELETE r")

        # Create indexes for faster lookups (ignore if already exist)
        try:
            tx.run("CREATE INDEX account_id IF NOT EXISTS FOR (a:Account) ON (a.id)")
        except Exception:
            pass

        # Create Account nodes with type labels
        for node_id in graph.all_nodes:
            stats = graph.node_stats.get(node_id)
            sus_info = sus_lookup.get(node_id)

            if sus_info:
                patterns = sus_info.get("detected_patterns", [])
                score = float(sus_info.get("suspicion_score", 0))
                labels = _get_account_labels(patterns, score)
            else:
                patterns = []
                score = 0.0
                labels = [LABEL_ACCOUNT, LABEL_LEGITIMATE]

            in_deg = stats.in_degree if stats else 0
            out_deg = stats.out_degree if stats else 0

            label_str = ":".join(labels)
            tx.run(
                f"""
                MERGE (a:{label_str} {{id: $id}})
                SET a.suspicion_score = $score,
                    a.in_degree = $in_deg,
                    a.out_degree = $out_deg,
                    a.patterns = $patterns
                """,
                id=node_id,
                score=score,
                in_deg=in_deg,
                out_deg=out_deg,
                patterns=patterns,
            )

        # Create SENT_TO relationships
        for tx_obj in graph.transactions:
            tx.run(
                """
                MATCH (a:Account {id: $sender})
                MATCH (b:Account {id: $receiver})
                MERGE (a)-[r:SENT_TO {transaction_id: $tx_id}]->(b)
                SET r.amount = $amount, r.timestamp = $timestamp
                """,
                sender=tx_obj.sender,
                receiver=tx_obj.receiver,
                tx_id=tx_obj.transaction_id,
                amount=float(tx_obj.amount),
                timestamp=tx_obj.timestamp.isoformat(),
            )

        # Optional: FraudRing nodes and RING_MEMBER relationships
        for ring in fraud_rings:
            ring_id = ring.get("ring_id", "")
            pattern_type = ring.get("pattern_type", "unknown")
            risk = float(ring.get("risk_score", 0))
            tx.run(
                """
                MERGE (r:FraudRing {id: $ring_id})
                SET r.pattern_type = $pattern_type, r.risk_score = $risk
                """,
                ring_id=ring_id,
                pattern_type=pattern_type,
                risk=risk,
            )
            for member_id in ring.get("member_accounts", []):
                tx.run(
                    """
                    MATCH (a:Account {id: $member})
                    MATCH (r:FraudRing {id: $ring_id})
                    MERGE (a)-[:RING_MEMBER]->(r)
                    """,
                    member=member_id,
                    ring_id=ring_id,
                )

    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            session.execute_write(_run_tx)
        driver.close()
        return True
    except Exception as e:
        print(f"DEBUG: Neo4j sync failed: {e}")
        return False


def fetch_graph_from_neo4j() -> Optional[dict]:
    """
    Fetch the typed graph from Neo4j. Returns nodes (with labels/types) and edges,
    or None if Neo4j is not configured or empty.
    """
    uri = os.environ.get("NEO4J_URI", "").strip()
    if not uri:
        return None

    try:
        from neo4j import GraphDatabase
    except ImportError:
        return None

    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "password")

    def _run_tx(tx):
        result = tx.run(
            """
            MATCH (a)-[r:SENT_TO]->(b)
            RETURN a.id AS source, b.id AS target, r.amount AS amount,
                   r.transaction_id AS transaction_id, r.timestamp AS timestamp
            """
        )
        edges = [
            {
                "source": r["source"],
                "target": r["target"],
                "amount": r["amount"],
                "transaction_id": r["transaction_id"],
                "timestamp": r["timestamp"],
            }
            for r in result
        ]

        result = tx.run(
            """
            MATCH (a:Account)
            RETURN a.id AS id, labels(a) AS labels,
                   a.suspicion_score AS suspicion_score,
                   a.in_degree AS in_degree, a.out_degree AS out_degree,
                   a.patterns AS patterns
            """
        )
        nodes = []
        for r in result:
            labels = [lbl for lbl in (r["labels"] or []) if lbl != "Account"]
            nodes.append({
                "id": r["id"],
                "types": labels,
                "suspicion_score": r["suspicion_score"] or 0,
                "in_degree": r["in_degree"] or 0,
                "out_degree": r["out_degree"] or 0,
                "patterns": r["patterns"] or [],
            })

        return {"nodes": nodes, "edges": edges}

    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            data = session.execute_read(_run_tx)
        driver.close()
        return data if data and (data["nodes"] or data["edges"]) else None
    except Exception as e:
        print(f"DEBUG: Neo4j fetch failed: {e}")
        return None
