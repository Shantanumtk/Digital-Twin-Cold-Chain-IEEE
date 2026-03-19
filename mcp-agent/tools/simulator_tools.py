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

# =============================================================================
# Profile Management Tools
# =============================================================================

import yaml as _yaml_module

PROFILES_DIR = os.getenv("PROFILES_DIR", "/home/ubuntu/CPSC-597-Digital-Twin-Cold-Chain/profiles")
ACTIVE_PROFILE = os.path.join(PROFILES_DIR, "active.yaml")


def get_active_profile() -> str:
    """Get the currently active profile configuration."""
    try:
        if not os.path.exists(ACTIVE_PROFILE):
            return json.dumps({"error": f"No active profile found at {ACTIVE_PROFILE}"})
        with open(ACTIVE_PROFILE) as f:
            profile = _yaml_module.safe_load(f)
        return json.dumps(profile, default=str)
    except Exception as e:
        return json.dumps({"error": f"Failed to read profile: {str(e)}"})


def list_profiles() -> str:
    """List all available profiles."""
    try:
        profiles = []
        if not os.path.exists(PROFILES_DIR):
            return json.dumps({"error": f"Profiles directory not found: {PROFILES_DIR}"})
        for fname in sorted(os.listdir(PROFILES_DIR)):
            if fname.endswith(".yaml") and fname != "active.yaml":
                fpath = os.path.join(PROFILES_DIR, fname)
                with open(fpath) as f:
                    p = _yaml_module.safe_load(f)
                profiles.append({
                    "filename": fname,
                    "name": p.get("name", fname),
                    "description": p.get("description", ""),
                    "fleet": p.get("fleet", {}),
                })
        return json.dumps({"profiles": profiles, "total": len(profiles)})
    except Exception as e:
        return json.dumps({"error": f"Failed to list profiles: {str(e)}"})


def switch_profile(profile_name: str) -> str:
    """Switch to a different profile by name. Restarts simulator with new fleet config."""
    try:
        # Find the profile file
        profile_file = os.path.join(PROFILES_DIR, f"{profile_name}.yaml")
        if not os.path.exists(profile_file):
            available = [f.replace(".yaml", "") for f in os.listdir(PROFILES_DIR)
                        if f.endswith(".yaml") and f != "active.yaml"]
            return json.dumps({
                "error": f"Profile '{profile_name}' not found",
                "available": available
            })

        # Read the profile
        with open(profile_file) as f:
            profile = _yaml_module.safe_load(f)

        # Copy as active profile
        import shutil
        shutil.copy2(profile_file, ACTIVE_PROFILE)

        # Restart simulator with new fleet config
        fleet = profile.get("fleet", {})
        num_trucks = fleet.get("trucks", 5)
        num_rooms = fleet.get("cold_rooms", 5)
        sim_config = profile.get("simulator", {})
        publish_interval = sim_config.get("publish_interval", 5.0)

        restart_result = restart_simulator(env_overrides={
            "NUM_TRUCKS": str(num_trucks),
            "NUM_COLD_ROOMS": str(num_rooms),
            "PUBLISH_INTERVAL": str(publish_interval),
        })

        return json.dumps({
            "action": "switch_profile",
            "profile": profile_name,
            "fleet": fleet,
            "thresholds": list(profile.get("thresholds", {}).keys()),
            "simulator_restart": json.loads(restart_result),
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to switch profile: {str(e)}"})


def update_threshold(threshold_type: str, temp_warning: float = None, temp_critical: float = None) -> str:
    """Update a threshold in the active profile."""
    try:
        if not os.path.exists(ACTIVE_PROFILE):
            return json.dumps({"error": "No active profile to update"})

        with open(ACTIVE_PROFILE) as f:
            profile = _yaml_module.safe_load(f)

        thresholds = profile.get("thresholds", {})
        if threshold_type not in thresholds:
            return json.dumps({
                "error": f"Unknown threshold type: {threshold_type}",
                "available": list(thresholds.keys())
            })

        if temp_warning is not None:
            thresholds[threshold_type]["temp_warning"] = temp_warning
        if temp_critical is not None:
            thresholds[threshold_type]["temp_critical"] = temp_critical

        profile["thresholds"] = thresholds

        with open(ACTIVE_PROFILE, "w") as f:
            _yaml_module.dump(profile, f, default_flow_style=False)

        return json.dumps({
            "action": "update_threshold",
            "threshold_type": threshold_type,
            "updated": thresholds[threshold_type],
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to update threshold: {str(e)}"})
