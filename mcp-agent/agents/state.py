"""
ColdChainState — Typed state object shared across all LangGraph nodes.
Every field is logged at each node boundary for honest P/R/F1 evaluation.
"""

from typing import TypedDict, Optional, List


class ColdChainState(TypedDict):
    # Input
    user_query: str
    asset_id: Optional[str]
    trace_id: str

    # Raw data fetched by nodes
    current_telemetry: Optional[dict]
    recent_events: Optional[List[dict]]

    # Supervisor output
    intent: Optional[str]        # "anomaly_query" | "status_query" | "simulation"

    # Anomaly classifier output
    anomaly_label: Optional[str]  # "TEMP_BREACH" | "COMPRESSOR_FAIL" | "DOOR_FAULT" | "POWER_OUTAGE" | "NORMAL"
    confidence: Optional[float]   # 0.0 – 1.0

    # RCA node output
    root_cause: Optional[str]     # 1-2 sentence explanation

    # Alert router output
    alert_required: bool
    alert_sent: bool
    response: Optional[str]

    # Full message history for LLM context
    messages: List[dict]

    # Per-node latency tracking (ms)
    node_latencies: Optional[dict]
