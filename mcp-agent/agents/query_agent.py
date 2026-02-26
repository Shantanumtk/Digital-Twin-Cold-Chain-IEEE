"""
Query Agent — Answers natural language questions about cold chain data.
Uses OpenAI-compatible API (KodeKloud proxy to Claude) with tool calling.
"""

import os
import json
from openai import OpenAI
from tools import mongo_tools, redis_tools, kafka_tools, mqtt_tools

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.ai.kodekloud.com/v1")
MODEL = os.getenv("LLM_MODEL", "anthropic/claude-sonnet-4.5")

SYSTEM_PROMPT = """You are a Cold Chain Digital Twin AI assistant. You help logistics operators 
monitor and analyze their refrigerated fleet (trucks and cold storage rooms).

You have access to real-time and historical data through these tools:
- MongoDB: Historical telemetry, alerts, asset state
- Redis: Real-time live state of all assets, active alerts
- Kafka: Recent streaming events and alerts
- MQTT: Live sensor readings directly from devices

When answering questions:
1. First check real-time data (Redis/MQTT) for current status
2. Then check recent events (Kafka) for context
3. Then query history (MongoDB) for trends and root cause analysis
4. Correlate findings across sources to give a comprehensive answer

Always provide specific data points (temperatures, timestamps, asset IDs).
If you detect anomalies, explain the likely cause based on correlated events.
Be concise but thorough. Use the data — don't speculate without evidence."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_live_state",
            "description": "Get real-time state of an asset from Redis (temperature, door status, compressor, state, reasons, etc.)",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset ID like 'truck-01' or 'sensor-room-site1-room1'"}
                },
                "required": ["asset_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_all_live_states",
            "description": "Get real-time state for ALL assets from Redis. Returns temperature, door, compressor, state for every asset.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_live_reading",
            "description": "Get the latest MQTT sensor reading directly from the device (bypasses Redis/MongoDB)",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset ID"}
                },
                "required": ["asset_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_active_sensors",
            "description": "List all sensors currently publishing MQTT data with their last update time",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_telemetry",
            "description": "Query historical telemetry readings from MongoDB for an asset",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset ID (truck_id like 'truck01' or sensor_id like 'sensor-room-site1-room1')"},
                    "hours": {"type": "integer", "description": "Hours of history to look back (default 2)"},
                    "limit": {"type": "integer", "description": "Max results to return (default 50)"}
                },
                "required": ["asset_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_asset_state_from_mongo",
            "description": "Get the current digital twin state for an asset from MongoDB (includes message count, last updated)",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset ID"}
                },
                "required": ["asset_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_breaches",
            "description": "Find temperature breach alerts from MongoDB. Returns alerts with anomaly details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Optional asset ID filter. Omit to get all breaches."},
                    "hours": {"type": "integer", "description": "Hours to look back (default 24)"},
                    "limit": {"type": "integer", "description": "Max results (default 20)"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "compare_assets",
            "description": "Compare current state across multiple assets side-by-side from Redis",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of asset IDs to compare. If empty, compares all."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_all_assets",
            "description": "List all known assets with their current state (NORMAL/WARNING/CRITICAL) and type",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_recent_events",
            "description": "Read recent events from Kafka topics (trucks telemetry, rooms telemetry, or alerts)",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic_key": {
                        "type": "string",
                        "description": "One of: 'trucks', 'rooms', 'alerts'",
                        "enum": ["trucks", "rooms", "alerts"]
                    },
                    "count": {"type": "integer", "description": "Number of recent messages to read (default 10)"}
                },
                "required": ["topic_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_active_alerts",
            "description": "Get all currently active alerts from Redis (assets in WARNING or CRITICAL state)",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Optional asset ID to filter alerts for a specific asset"}
                }
            }
        }
    },
]

TOOL_HANDLERS = {
    "get_live_state": lambda args: redis_tools.get_live_state(**args),
    "get_all_live_states": lambda args: redis_tools.get_all_live_states(),
    "get_live_reading": lambda args: mqtt_tools.get_live_reading(**args),
    "list_active_sensors": lambda args: mqtt_tools.list_active_sensors(),
    "query_telemetry": lambda args: mongo_tools.query_telemetry(**args),
    "get_asset_state_from_mongo": lambda args: mongo_tools.get_asset_state(**args),
    "find_breaches": lambda args: mongo_tools.find_breaches(**args),
    "compare_assets": lambda args: redis_tools.compare_assets(**args),
    "list_all_assets": lambda args: redis_tools.list_all_assets(),
    "read_recent_events": lambda args: kafka_tools.read_recent_events(**args),
    "get_active_alerts": lambda args: redis_tools.get_active_alerts(**args),
}


def process_query(user_message: str, conversation_history: list = None) -> str:
    """Process a natural language query using OpenAI-compatible API with tool calling."""
    client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    max_iterations = 10
    for _ in range(max_iterations):
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )

        choice = response.choices[0]

        if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
            messages.append(choice.message)

            for tool_call in choice.message.tool_calls:
                tool_name = tool_call.function.name
                try:
                    tool_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                handler = TOOL_HANDLERS.get(tool_name)
                if handler:
                    try:
                        result = handler(tool_args)
                    except Exception as e:
                        result = json.dumps({"error": f"Tool {tool_name} failed: {str(e)}"})
                else:
                    result = json.dumps({"error": f"Unknown tool: {tool_name}"})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })
        else:
            return choice.message.content or "No response generated."

    return "Query processing exceeded maximum iterations. Please try a more specific question."