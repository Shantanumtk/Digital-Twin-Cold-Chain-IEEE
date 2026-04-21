"""
Query Agent — LangGraph StateGraph implementation.

Pipeline (anomaly path):
  START → supervisor → anomaly_classifier → rca → alert_router → END

Pipeline (status path):
  START → supervisor → status_query → END

Pipeline (simulation path):
  START → supervisor → alert_router → END

This is the paper's core contribution: a typed, inspectable, evaluable
multi-agent pipeline with per-node latency measurement and logged state.

ColdChainState TypedDict means every field at every node boundary is
loggable — enabling honest P/R/F1 evaluation in eval/harness.py.
"""

import uuid
import logging
import time
from typing import Optional

from langgraph.graph import StateGraph, START, END

from agents.state import ColdChainState
from agents.nodes import (
    supervisor_node,
    anomaly_classifier_node,
    rca_node,
    alert_router_node,
    status_query_node,
    route_from_supervisor,
)

logger = logging.getLogger(__name__)

# =============================================================================
# Build the StateGraph
# =============================================================================

def _build_graph() -> StateGraph:
    graph = StateGraph(ColdChainState)

    # Register nodes
    graph.add_node("supervisor",          supervisor_node)
    graph.add_node("anomaly_classifier",  anomaly_classifier_node)
    graph.add_node("rca",                 rca_node)
    graph.add_node("alert_router",        alert_router_node)
    graph.add_node("status_query",        status_query_node)

    # Entry edge
    graph.add_edge(START, "supervisor")

    # Conditional routing from supervisor
    graph.add_conditional_edges(
        "supervisor",
        route_from_supervisor,
        {
            "anomaly_query": "anomaly_classifier",
            "status_query":  "status_query",
            "simulation":    "alert_router",
        },
    )

    # Anomaly path: classifier → rca → alert_router
    graph.add_edge("anomaly_classifier", "rca")
    graph.add_edge("rca",                "alert_router")

    # Terminal edges
    graph.add_edge("alert_router", END)
    graph.add_edge("status_query", END)

    return graph


# Compile once at module load — reused across all requests
_compiled_graph = _build_graph().compile()


# =============================================================================
# Public API
# =============================================================================

def process_query(user_message: str, conversation_history: Optional[list] = None) -> str:
    """
    Process a natural language query through the LangGraph pipeline.

    Args:
        user_message: The user's natural language question or command.
        conversation_history: Prior conversation turns (list of role/content dicts).

    Returns:
        Final response string from the pipeline.
    """
    t_total = time.perf_counter()

    # Extract asset_id hint from message if present
    asset_id = _extract_asset_id(user_message)

    # Build initial state
    initial_state: ColdChainState = {
        "user_query":        user_message,
        "asset_id":          asset_id,
        "trace_id":          str(uuid.uuid4()),
        "current_telemetry": None,
        "recent_events":     None,
        "intent":            None,
        "anomaly_label":     None,
        "confidence":        None,
        "root_cause":        None,
        "alert_required":    False,
        "alert_sent":        False,
        "response":          None,
        "messages":          conversation_history or [],
        "node_latencies":    {},
    }

    try:
        final_state = _compiled_graph.invoke(initial_state)
    except Exception as e:
        logger.error(f"[process_query] graph invocation failed: {e}", exc_info=True)
        return f"Query processing failed: {e}"

    total_ms = (time.perf_counter() - t_total) * 1000
    lats = final_state.get("node_latencies") or {}

    logger.info(
        f"[process_query] DONE trace={final_state['trace_id']} "
        f"intent={final_state.get('intent')} "
        f"label={final_state.get('anomaly_label')} "
        f"total_ms={total_ms:.1f} "
        f"node_latencies={lats}"
    )

    return final_state.get("response") or "No response generated."


def process_query_with_state(
    user_message: str,
    conversation_history: Optional[list] = None,
) -> ColdChainState:
    """
    Like process_query() but returns the full ColdChainState.
    Used by eval/harness.py to inspect anomaly_label, confidence, etc.
    """
    asset_id = _extract_asset_id(user_message)

    initial_state: ColdChainState = {
        "user_query":        user_message,
        "asset_id":          asset_id,
        "trace_id":          str(uuid.uuid4()),
        "current_telemetry": None,
        "recent_events":     None,
        "intent":            None,
        "anomaly_label":     None,
        "confidence":        None,
        "root_cause":        None,
        "alert_required":    False,
        "alert_sent":        False,
        "response":          None,
        "messages":          conversation_history or [],
        "node_latencies":    {},
    }

    return _compiled_graph.invoke(initial_state)


# =============================================================================
# Helper
# =============================================================================

def _extract_asset_id(message: str) -> Optional[str]:
    """
    Extract asset_id hint from a message.
    Matches patterns like: truck01, truck-01, site1-room1, sensor-room-site1-room2
    """
    import re
    patterns = [
        r"\b(truck\d+)\b",
        r"\b(truck-\d+)\b",
        r"\b(site\d+-room\d+)\b",
        r"\b(sensor-room-site\d+-room\d+)\b",
        r"\b(sensor-truck-truck\d+)\b",
    ]
    for pat in patterns:
        m = re.search(pat, message, re.IGNORECASE)
        if m:
            return m.group(1).lower()
    return None
