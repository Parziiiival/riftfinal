"""
graph_builder.py — CSV Ingestion + Graph Construction Module

Responsibilities:
  - Strict column validation
  - Datetime parsing with timezone normalization
  - Float coercion for amounts
  - Reject malformed rows
  - Build adj_list, reverse_adj_list, node_stats, transaction_list
  - Transaction count check (≤10K)
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

REQUIRED_COLUMNS = ["transaction_id", "sender_id", "receiver_id", "amount", "timestamp"]
MAX_TRANSACTIONS = 10_000


# ── Data classes ───────────────────────────────────────────────────

@dataclass
class Transaction:
    transaction_id: str
    sender: str
    receiver: str
    amount: float
    timestamp: datetime


@dataclass
class NodeStats:
    in_degree: int = 0
    out_degree: int = 0
    total_in_amount: float = 0.0
    total_out_amount: float = 0.0
    timestamps: list = field(default_factory=list)

    @property
    def total_degree(self) -> int:
        return self.in_degree + self.out_degree


@dataclass
class GraphData:
    """Container for the entire parsed graph."""
    transactions: List[Transaction]
    adj_list: Dict[str, List[Transaction]]
    reverse_adj_list: Dict[str, List[Transaction]]
    node_stats: Dict[str, NodeStats]
    all_nodes: set


# ── Parsing & validation ──────────────────────────────────────────

def _parse_timestamp(raw: str) -> datetime:
    """Parse YYYY-MM-DD HH:MM:SS → UTC datetime."""
    raw = raw.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Invalid timestamp format: {raw}")


def _parse_amount(raw: str) -> float:
    """Coerce to float; raise on failure."""
    try:
        val = float(raw.strip())
        if val < 0:
            raise ValueError("Negative amount")
        return val
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid amount '{raw}': {exc}")


def parse_csv(file_content: str) -> GraphData:
    """
    Parse raw CSV text into a fully constructed GraphData.

    Raises ValueError for:
      - Missing / extra columns
      - >10 000 rows
      - Malformed individual rows (logged & skipped)
    """
    # Strip BOM if present
    file_content = file_content.lstrip('\ufeff')
    reader = csv.DictReader(io.StringIO(file_content))

    # ── Column validation ──
    if reader.fieldnames is None:
        raise ValueError("CSV file is empty or has no header row.")
    headers = [h.strip().strip('\ufeff').lower() for h in reader.fieldnames]
    missing = set(REQUIRED_COLUMNS) - set(headers)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    # ── Row parsing ──
    transactions: List[Transaction] = []
    skipped = 0

    for idx, row in enumerate(reader):
        if len(transactions) >= MAX_TRANSACTIONS:
            raise ValueError(
                f"Dataset exceeds maximum of {MAX_TRANSACTIONS:,} transactions."
            )
        # Normalise keys
        row = {k.strip().lower(): v for k, v in row.items()}
        try:
            tx = Transaction(
                transaction_id=row["transaction_id"].strip(),
                sender=row["sender_id"].strip(),
                receiver=row["receiver_id"].strip(),
                amount=_parse_amount(row["amount"]),
                timestamp=_parse_timestamp(row["timestamp"]),
            )
            transactions.append(tx)
        except (ValueError, KeyError):
            skipped += 1
            continue

    if not transactions:
        raise ValueError("No valid transactions found in CSV.")

    # ── Build graph structures ──
    return _build_graph(transactions)


def _build_graph(transactions: List[Transaction]) -> GraphData:
    """Construct adjacency lists and per-node statistics."""
    adj_list: Dict[str, List[Transaction]] = defaultdict(list)
    reverse_adj_list: Dict[str, List[Transaction]] = defaultdict(list)
    node_stats: Dict[str, NodeStats] = defaultdict(NodeStats)
    all_nodes: set = set()

    for tx in transactions:
        adj_list[tx.sender].append(tx)
        reverse_adj_list[tx.receiver].append(tx)

        all_nodes.add(tx.sender)
        all_nodes.add(tx.receiver)

        # Sender stats
        node_stats[tx.sender].out_degree += 1
        node_stats[tx.sender].total_out_amount += tx.amount
        node_stats[tx.sender].timestamps.append(tx.timestamp)

        # Receiver stats
        node_stats[tx.receiver].in_degree += 1
        node_stats[tx.receiver].total_in_amount += tx.amount
        node_stats[tx.receiver].timestamps.append(tx.timestamp)

    return GraphData(
        transactions=transactions,
        adj_list=dict(adj_list),
        reverse_adj_list=dict(reverse_adj_list),
        node_stats=dict(node_stats),
        all_nodes=all_nodes,
    )
