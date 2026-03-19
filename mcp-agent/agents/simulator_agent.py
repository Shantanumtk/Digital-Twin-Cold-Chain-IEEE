"""
Simulator Controller Agent — Controls docker-compose sensor environment
through natural language commands using OpenAI-compatible API with tool calling.
"""

import os
import json
from openai import OpenAI
from tools import simulator_tools

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.ai.kodekloud.com/v1")
MODEL = os.getenv("LLM_MODEL", "anthropic/claude-sonnet-4.5")

SYSTEM_PROMPT = """You are a Cold Chain Simulation Controller. You can manipulate the sensor
simulator environment to create test scenarios for the cold chain monitoring system.

You control a docker-compose environment running on an EC2 instance that simulates:
- Refrigerated trucks (truck01, truck02, ... truck12) with temperature, door, compressor, GPS
- Cold storage rooms (site1/room1, site2/room2, etc.) with temperature, humidity, door, compressor

You can:
- Open/close doors on trucks or rooms to simulate loading events
- Trigger compressor failures to simulate equipment breakdowns
- Simulate power outages at warehouse sites (affects all rooms at that site)
- Scale the fleet (add/remove trucks and cold rooms)
- Restart the simulator with different configurations
- Check current simulator status and config

When the user describes a scenario:
1. Figure out which tools to call
2. Execute them
3. Confirm what you did
4. Explain what the user should expect to see in the monitoring dashboard

Be specific about timings, asset IDs, and expected temperature effects."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_simulator_status",
            "description": "Get current status of the sensor simulator container (running, stopped, etc.)",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_simulator_env",
            "description": "Get current simulator configuration — number of trucks, rooms, publish interval, etc.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_door_event",
            "description": "Open a truck or room door for a specified duration. This causes temperature to rise rapidly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset ID — for trucks use 'truck01', 'truck02', etc. For rooms use 'site1-room1', etc."},
                    "duration_seconds": {"type": "integer", "description": "How long door stays open in seconds (default 60)"}
                },
                "required": ["asset_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_compressor_failure",
            "description": "Simulate compressor failure on an asset. Temperature will gradually rise without active cooling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset ID (e.g. 'truck05', 'site1-room3')"},
                    "duration_seconds": {"type": "integer", "description": "Duration of failure in seconds (default 300 = 5 min)"}
                },
                "required": ["asset_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_power_outage",
            "description": "Simulate power outage at a warehouse site. All cold rooms at the site lose compressor power.",
            "parameters": {
                "type": "object",
                "properties": {
                    "site_id": {"type": "string", "description": "Site ID: 'site1', 'site2', or 'site3' (default 'site1')"},
                    "duration_seconds": {"type": "integer", "description": "Duration of outage in seconds (default 600 = 10 min)"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "scale_fleet",
            "description": "Change the number of simulated trucks and/or cold rooms. Restarts the simulator.",
            "parameters": {
                "type": "object",
                "properties": {
                    "num_trucks": {"type": "integer", "description": "New number of trucks"},
                    "num_cold_rooms": {"type": "integer", "description": "New number of cold rooms"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_active_profile",
            "description": "Get the currently active configuration profile (fleet size, thresholds, assignments)",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_profiles",
            "description": "List all available configuration profiles",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "switch_profile",
            "description": "Switch to a different configuration profile. Restarts simulator with new fleet config and updates thresholds.",
            "parameters": {
                "type": "object",
                "properties": {
                    "profile_name": {"type": "string", "description": "Profile name: 'default', 'frozen-logistics', 'pharma-delivery', 'stress-test', 'demo'"}
                },
                "required": ["profile_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_threshold",
            "description": "Update temperature thresholds in the active profile for a specific threshold type",
            "parameters": {
                "type": "object",
                "properties": {
                    "threshold_type": {"type": "string", "description": "One of: frozen_goods, chilled_goods, pharma, ambient_storage"},
                    "temp_warning": {"type": "number", "description": "New warning temperature threshold in Celsius"},
                    "temp_critical": {"type": "number", "description": "New critical temperature threshold in Celsius"}
                },
                "required": ["threshold_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "restart_simulator",
            "description": "Restart the sensor simulator with optional config changes (publish interval, counts, etc.)",
            "parameters": {
                "type": "object",
                "properties": {
                    "env_overrides": {
                        "type": "object",
                        "description": "Environment variable overrides, e.g. {'PUBLISH_INTERVAL': '0.5', 'NUM_TRUCKS': '20'}"
                    }
                }
            }
        }
    },
]

TOOL_HANDLERS = {
    "get_simulator_status": lambda args: simulator_tools.get_simulator_status(),
    "get_simulator_env": lambda args: simulator_tools.get_simulator_env(),
    "trigger_door_event": lambda args: simulator_tools.trigger_door_event(**args),
    "trigger_compressor_failure": lambda args: simulator_tools.trigger_compressor_failure(**args),
    "trigger_power_outage": lambda args: simulator_tools.trigger_power_outage(**args),
    "scale_fleet": lambda args: simulator_tools.scale_fleet(**args),
    "restart_simulator": lambda args: simulator_tools.restart_simulator(**args),
    "get_active_profile": lambda args: simulator_tools.get_active_profile(),
    "list_profiles": lambda args: simulator_tools.list_profiles(),
    "switch_profile": lambda args: simulator_tools.switch_profile(**args),
    "update_threshold": lambda args: simulator_tools.update_threshold(**args),
}


def process_command(user_message: str, conversation_history: list = None) -> str:
    """Process a simulation command using OpenAI-compatible API with tool calling."""
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
                handler = TOOL_HANDLERS.get(tool_call.function.name)
                try:
                    tool_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                if handler:
                    try:
                        result = handler(tool_args)
                    except Exception as e:
                        result = json.dumps({"error": f"Tool {tool_call.function.name} failed: {str(e)}"})
                else:
                    result = json.dumps({"error": f"Unknown tool: {tool_call.function.name}"})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })
        else:
            return choice.message.content or "No response generated."

    return "Simulation command processing exceeded maximum iterations."