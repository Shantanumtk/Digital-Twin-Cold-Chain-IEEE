"""
MCP Agent Host — FastAPI server exposing Query Agent and Simulator Agent
as REST endpoints. Runs on MQTT EC2 instance, port 8001.

Endpoints:
  POST /api/chat/query     — Query agent (MongoDB, Redis, Kafka, MQTT)
  POST /api/chat/simulate  — Simulation controller agent (docker-compose)
  GET  /api/health         — Health check
"""

import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agents.query_agent import process_query
from agents.simulator_agent import process_command

app = FastAPI(
    title="Cold Chain MCP Agent",
    description="AI-powered query and simulation control for Cold Chain Digital Twin",
    version="1.0.0",
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


# Simple in-memory conversation store
conversations: dict[str, list] = {}


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    return {
        "status": "healthy",
        "service": "mcp-agent",
        "api_key_set": bool(api_key),
        "base_url": os.getenv("OPENAI_BASE_URL", "not set"),
        "model": os.getenv("LLM_MODEL", "not set"),
    }


@app.post("/api/chat/query", response_model=ChatResponse)
async def chat_query(request: ChatRequest):
    """Query agent — ask questions about cold chain data."""
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    conv_id = request.conversation_id or "default"
    history = conversations.get(conv_id, [])

    try:
        response_text = process_query(request.message, history.copy())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query agent error: {str(e)}")

    history.append({"role": "user", "content": request.message})
    history.append({"role": "assistant", "content": response_text})
    conversations[conv_id] = history[-20:]

    return ChatResponse(response=response_text, conversation_id=conv_id)


@app.post("/api/chat/simulate", response_model=ChatResponse)
async def chat_simulate(request: ChatRequest):
    """Simulation controller — manipulate the sensor simulator."""
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    conv_id = request.conversation_id or "default-sim"
    history = conversations.get(conv_id, [])

    try:
        response_text = process_command(request.message, history.copy())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulator agent error: {str(e)}")

    history.append({"role": "user", "content": request.message})
    history.append({"role": "assistant", "content": response_text})
    conversations[conv_id] = history[-20:]

    return ChatResponse(response=response_text, conversation_id=conv_id)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8001"))

    print(f"🚀 MCP Agent Host starting on {host}:{port}")
    uvicorn.run(app, host=host, port=port)