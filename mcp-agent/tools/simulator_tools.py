"""
Simulator Controller Tools — Manipulate docker-compose sensor environment.
Runs on the same EC2 as the sensor simulator.

Commands are sent via MQTT to topics the simulator subscribes to:
  commands/{asset_id}/door        — open/close door
  commands/{asset_id}/compressor  — fail/restore compressor
  commands/{site_id}/power        — power outage/restore
"""

import os
import json
import subprocess

SIMULATOR_DIR = os.getenv("SIMULATOR_DIR", "/home/ubuntu/CPSC-597-Digital-Twin-Cold-Chain")


def _run_cmd(cmd: str, cwd: str = None) -> dict:
    """Run a shell command and return result."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=30, cwd=cwd or SIMULATOR_DIR
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Command timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_simulator_status() -> str:
    """Get the current status of the sensor simulator containers."""
    # Try docker compose first, then docker ps for manually run containers
    result = _run_cmd("docker compose ps --format json 2>/dev/null || docker ps --filter name=coldchain --format json")

    if not result["success"] or not result["stdout"]:
        result = _run_cmd("docker ps --filter name=coldchain --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'")

    return json.dumps(result)


def get_simulator_env() -> str:
    """Get current environment variables of the sensor simulator."""
    # Try docker compose exec first
    result = _run_cmd(
        "docker compose exec -T sensor-simulator env 2>/dev/null || "
        "docker exec coldchain-sensor-simulator env 2>/dev/null"
    )

    if result["success"]:
        env_vars = {}
        for line in result["stdout"].split("\n"):
            if any(k in line for k in ["NUM_", "PUBLISH_", "MQTT_", "BREACH_", "DOOR_", "COMPRESSOR_"]):
                key, _, value = line.partition("=")
                env_vars[key] = value
        return json.dumps({"simulator_config": env_vars})

    return json.dumps(result)


def restart_simulator(env_overrides: dict = None) -> str:
    """Restart the sensor simulator with optional environment variable overrides."""
    # Stop existing containers
    _run_cmd("docker stop coldchain-sensor-simulator 2>/dev/null; docker rm coldchain-sensor-simulator 2>/dev/null")

    # Build env args
    env_args = ""
    num_trucks = "12"
    num_rooms = "10"
    publish_interval = "5.0"

    if env_overrides:
        num_trucks = env_overrides.get("NUM_TRUCKS", num_trucks)
        num_rooms = env_overrides.get("NUM_COLD_ROOMS", num_rooms)
        publish_interval = env_overrides.get("PUBLISH_INTERVAL", publish_interval)

    cmd = (
        f"docker run -d "
        f"--name coldchain-sensor-simulator "
        f"--network host "
        f"-e MQTT_BROKER=localhost "
        f"-e MQTT_PORT=1883 "
        f"-e MQTT_QOS=1 "
        f"-e PUBLISH_INTERVAL={publish_interval} "
        f"-e NUM_COLD_ROOMS={num_rooms} "
        f"-e NUM_TRUCKS={num_trucks} "
        f"--restart unless-stopped "
        f"coldchain-sensor-simulator"
    )

    result = _run_cmd(cmd, cwd="/tmp")
    return json.dumps({"action": "restart_simulator", "env_overrides": env_overrides, **result})


def trigger_door_event(asset_id: str, duration_seconds: int = 60) -> str:
    """Simulate a door-open event by publishing an MQTT command."""
    topic = f"commands/{asset_id}/door"
    payload = json.dumps({"action": "open", "duration_seconds": duration_seconds})

    cmd = f"mosquitto_pub -h localhost -t '{topic}' -m '{payload}'"
    result = _run_cmd(cmd, cwd="/tmp")

    return json.dumps({
        "action": "door_open",
        "asset_id": asset_id,
        "duration_seconds": duration_seconds,
        "topic": topic,
        **result
    })


def trigger_compressor_failure(asset_id: str, duration_seconds: int = 300) -> str:
    """Simulate a compressor failure by publishing an MQTT command."""
    topic = f"commands/{asset_id}/compressor"
    payload = json.dumps({"action": "fail", "duration_seconds": duration_seconds})

    cmd = f"mosquitto_pub -h localhost -t '{topic}' -m '{payload}'"
    result = _run_cmd(cmd, cwd="/tmp")

    return json.dumps({
        "action": "compressor_failure",
        "asset_id": asset_id,
        "duration_seconds": duration_seconds,
        **result
    })


def trigger_power_outage(site_id: str = "site1", duration_seconds: int = 600) -> str:
    """Simulate a power outage at a warehouse site."""
    topic = f"commands/{site_id}/power"
    payload = json.dumps({"action": "outage", "duration_seconds": duration_seconds})

    cmd = f"mosquitto_pub -h localhost -t '{topic}' -m '{payload}'"
    result = _run_cmd(cmd, cwd="/tmp")

    return json.dumps({
        "action": "power_outage",
        "site_id": site_id,
        "duration_seconds": duration_seconds,
        **result
    })


def scale_fleet(num_trucks: int = None, num_cold_rooms: int = None) -> str:
    """Scale the simulated fleet size by restarting with new counts."""
    env = {}
    if num_trucks is not None:
        env["NUM_TRUCKS"] = str(num_trucks)
    if num_cold_rooms is not None:
        env["NUM_COLD_ROOMS"] = str(num_cold_rooms)

    if not env:
        return json.dumps({"error": "Specify num_trucks and/or num_cold_rooms"})

    return restart_simulator(env_overrides=env)