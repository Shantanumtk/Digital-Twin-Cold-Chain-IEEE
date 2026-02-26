"""
Redis MCP Tools — Real-time digital twin state from Redis.
Connects to Redis running on EKS (via NodePort).

Key prefixes used by state-engine:
  asset:state:{asset_id}  — current asset state
  alert:active:{asset_id} — active alerts
  assets:index            — set of all asset IDs
  alerts:active:index     — set of asset IDs with active alerts
"""

import os
import json
import redis

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))

ASSET_STATE_PREFIX = "asset:state:"
ALERT_ACTIVE_PREFIX = "alert:active:"

_redis = None


def get_redis():
    global _redis
    if _redis is None:
        _redis = redis.Redis(
            host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB,
            decode_responses=True, socket_connect_timeout=5
        )
    return _redis


def get_live_state(asset_id: str) -> str:
    """Get the real-time state of an asset from Redis.

    Args:
        asset_id: The asset identifier (e.g. 'truck01', 'sensor-room-site1-room1')

    Returns:
        JSON string with current state from Redis.
    """
    r = get_redis()
    key = f"{ASSET_STATE_PREFIX}{asset_id}"
    data = r.get(key)

    if not data:
        # Try scanning for partial match
        all_keys = r.keys(f"{ASSET_STATE_PREFIX}*{asset_id}*")
        if all_keys:
            data = r.get(all_keys[0])
            if data:
                state = json.loads(data)
                actual_id = all_keys[0].replace(ASSET_STATE_PREFIX, "")
                return json.dumps({"asset_id": actual_id, "source": "redis_live", **state})

        return json.dumps({"message": f"No live state found in Redis for {asset_id}"})

    state = json.loads(data)
    return json.dumps({"asset_id": asset_id, "source": "redis_live", **state})


def get_all_live_states() -> str:
    """Get real-time state for ALL assets from Redis.

    Returns:
        JSON string with all asset states.
    """
    r = get_redis()
    asset_ids = r.smembers("assets:index")

    if not asset_ids:
        return json.dumps({"message": "No live states found in Redis"})

    results = []
    pipe = r.pipeline(transaction=False)
    sorted_ids = sorted(asset_ids)
    for aid in sorted_ids:
        pipe.get(f"{ASSET_STATE_PREFIX}{aid}")
    values = pipe.execute()

    for asset_id, data in zip(sorted_ids, values):
        if data:
            state = json.loads(data)
            state["asset_id"] = asset_id
            results.append(state)

    if not results:
        return json.dumps({"message": "No live states found in Redis"})

    return json.dumps(results)


def get_active_alerts(asset_id: str = None) -> str:
    """Get currently active alerts from Redis.

    Args:
        asset_id: Optional — filter by asset. If None, returns all active alerts.

    Returns:
        JSON string with active alert data.
    """
    r = get_redis()

    if asset_id:
        key = f"{ALERT_ACTIVE_PREFIX}{asset_id}"
        data = r.get(key)
        if not data:
            return json.dumps({"message": f"No active alert for {asset_id}"})
        alert = json.loads(data)
        alert["asset_id"] = asset_id
        return json.dumps([alert])

    # Get all active alerts
    alert_ids = r.smembers("alerts:active:index")
    if not alert_ids:
        return json.dumps({"message": "No active alerts in Redis"})

    pipe = r.pipeline(transaction=False)
    sorted_ids = sorted(alert_ids)
    for aid in sorted_ids:
        pipe.get(f"{ALERT_ACTIVE_PREFIX}{aid}")
    values = pipe.execute()

    alerts = []
    for aid, data in zip(sorted_ids, values):
        if data:
            alert = json.loads(data)
            alert["asset_id"] = aid
            alerts.append(alert)

    if not alerts:
        return json.dumps({"message": "No active alerts found"})

    return json.dumps(alerts)


def compare_assets(asset_ids: list = None) -> str:
    """Compare current state across multiple assets from Redis.

    Args:
        asset_ids: List of asset IDs. If None/empty, compares all assets.

    Returns:
        JSON string with comparison data.
    """
    r = get_redis()

    if not asset_ids:
        asset_ids = sorted(r.smembers("assets:index"))

    if not asset_ids:
        return json.dumps({"message": "No assets found"})

    pipe = r.pipeline(transaction=False)
    for aid in asset_ids:
        pipe.get(f"{ASSET_STATE_PREFIX}{aid}")
    values = pipe.execute()

    results = []
    for aid, data in zip(asset_ids, values):
        if data:
            state = json.loads(data)
            results.append({
                "asset_id": aid,
                "state": state.get("state", "UNKNOWN"),
                "temperature_c": state.get("temperature_c"),
                "humidity_pct": state.get("humidity_pct"),
                "door_open": state.get("door_open"),
                "compressor_running": state.get("compressor_running"),
                "asset_type": state.get("asset_type"),
                "updated_at": state.get("updated_at"),
            })

    if not results:
        return json.dumps({"message": "No states found for requested assets"})

    return json.dumps(results)


def list_all_assets() -> str:
    """List all known assets with their current state and type.

    Returns:
        JSON string with list of asset IDs, states, and types.
    """
    r = get_redis()
    asset_ids = r.smembers("assets:index")

    if not asset_ids:
        return json.dumps({"message": "No assets found in Redis"})

    pipe = r.pipeline(transaction=False)
    sorted_ids = sorted(asset_ids)
    for aid in sorted_ids:
        pipe.get(f"{ASSET_STATE_PREFIX}{aid}")
    values = pipe.execute()

    results = []
    for aid, data in zip(sorted_ids, values):
        if data:
            state = json.loads(data)
            results.append({
                "asset_id": aid,
                "state": state.get("state", "UNKNOWN"),
                "asset_type": state.get("asset_type", "unknown"),
                "temperature_c": state.get("temperature_c"),
            })

    return json.dumps(results)