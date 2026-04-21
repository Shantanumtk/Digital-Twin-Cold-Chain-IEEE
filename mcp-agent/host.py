"""
MCP Agent Host — FastAPI server exposing Query Agent (LangGraph) and Simulator Agent
as REST endpoints. Runs on MQTT EC2 instance, port 8001.

Endpoints:
  POST /api/chat/query     — LangGraph multi-agent pipeline (supervisor→classifier→rca→alert)
  POST /api/chat/simulate  — Simulation controller agent (docker-compose)
  GET  /api/health         — Health check with graph status
  GET  /api/graph          — LangGraph StateGraph visualization data
"""

import os
import time
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agents.query_agent import process_query, process_query_with_state
from agents.simulator_agent import process_command

app = FastAPI(
    title="Cold Chain MCP Agent",
    description="LangGraph multi-agent pipeline for Cold Chain Digital Twin",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None


class ChatResponse(BaseModel):
    response: str
    conversation_id: str | None = None
    # LangGraph state fields — exposed for dashboard & eval harness
    trace_id: str | None = None
    intent: str | None = None
    anomaly_label: str | None = None
    confidence: float | None = None
    root_cause: str | None = None
    alert_required: bool = False
    alert_sent: bool = False
    node_latencies: dict | None = None


# Simple in-memory conversation store (query agent only — 10-turn window)
conversations: dict[str, list] = {}


@app.get("/api/health")
async def health():
    """Health check — verifies LangGraph graph is compiled and API key is set."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    # Verify graph is accessible
    try:
        from agents.query_agent import _compiled_graph
        graph_ok = _compiled_graph is not None
    except Exception:
        graph_ok = False

    return {
        "status":      "healthy" if graph_ok else "degraded",
        "service":     "mcp-agent",
        "agent_type":  "langgraph_stategraph",
        "graph_ok":    graph_ok,
        "api_key_set": bool(api_key),
        "base_url":    os.getenv("OPENAI_BASE_URL", "not set"),
        "model":       os.getenv("LLM_MODEL", "not set"),
        "nodes": [
            "supervisor",
            "anomaly_classifier",
            "rca",
            "alert_router",
            "status_query",
        ],
    }


@app.get("/api/graph")
async def graph_info():
    """Return the LangGraph StateGraph topology for visualization."""
    return {
        "nodes": [
            {"id": "supervisor",         "type": "entry",    "description": "Routes query intent"},
            {"id": "anomaly_classifier", "type": "specialist", "description": "Classifies fault type"},
            {"id": "rca",                "type": "specialist", "description": "24h root cause analysis"},
            {"id": "alert_router",       "type": "exit",     "description": "SNS alert decision + response"},
            {"id": "status_query",       "type": "exit",     "description": "Live fleet status queries"},
        ],
        "edges": [
            {"from": "START",              "to": "supervisor",         "type": "direct"},
            {"from": "supervisor",         "to": "anomaly_classifier", "type": "conditional", "condition": "anomaly_query"},
            {"from": "supervisor",         "to": "status_query",       "type": "conditional", "condition": "status_query"},
            {"from": "supervisor",         "to": "alert_router",       "type": "conditional", "condition": "simulation"},
            {"from": "anomaly_classifier", "to": "rca",                "type": "direct"},
            {"from": "rca",                "to": "alert_router",       "type": "direct"},
            {"from": "alert_router",       "to": "END",                "type": "direct"},
            {"from": "status_query",       "to": "END",                "type": "direct"},
        ],
    }


@app.post("/api/chat/query", response_model=ChatResponse)
async def chat_query(request: ChatRequest):
    """
    LangGraph query agent — full multi-agent pipeline.
    Returns full ColdChainState fields for eval harness / dashboard.
    """
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    conv_id = request.conversation_id or "default"
    history = conversations.get(conv_id, [])

    try:
        # Use full-state version so we can return all LangGraph fields
        final_state = process_query_with_state(request.message, history.copy())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LangGraph pipeline error: {str(e)}")

    response_text = final_state.get("response") or "No response generated."

    # Update conversation history
    history.append({"role": "user",      "content": request.message})
    history.append({"role": "assistant", "content": response_text})
    conversations[conv_id] = history[-10:]  # keep 5 turns (10 messages)

    return ChatResponse(
        response       = response_text,
        conversation_id= conv_id,
        trace_id       = final_state.get("trace_id"),
        intent         = final_state.get("intent"),
        anomaly_label  = final_state.get("anomaly_label"),
        confidence     = final_state.get("confidence"),
        root_cause     = final_state.get("root_cause"),
        alert_required = bool(final_state.get("alert_required")),
        alert_sent     = bool(final_state.get("alert_sent")),
        node_latencies = final_state.get("node_latencies"),
    )


@app.post("/api/chat/simulate", response_model=ChatResponse)
async def chat_simulate(request: ChatRequest):
    """
    Simulation controller — each command is stateless for reliable tool execution.
    Does NOT go through LangGraph (simulator commands are not anomaly queries).
    """
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    try:
        response_text = process_command(request.message, [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulator agent error: {str(e)}")

    return ChatResponse(
        response        = response_text,
        conversation_id = None,
        intent          = "simulation",
    )


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8001"))
    print(f"🚀 MCP Agent Host (LangGraph) starting on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
