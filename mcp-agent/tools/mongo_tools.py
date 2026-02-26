"""
MongoDB MCP Tools — Historical telemetry and alert queries.
Connects to MongoDB on the private EC2 instance within the VPC.

Collections used:
  telemetry — raw sensor readings (written by kafka_consumer)
  assets    — digital twin state (written by kafka_consumer)
  alerts    — alert events (written by kafka_consumer)
"""

import os
import json
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "coldchain")

_client = None
_db = None


def get_db():
    global _client, _db
    if _db is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        _db = _client[MONGO_DB]
    return _db


def query_telemetry(asset_id: str, hours: int = 2, limit: int = 50) -> str:
    """Query historical telemetry readings for an asset.

    Args:
        asset_id: The asset identifier (e.g. 'truck01', 'sensor-room-site1-room1')
        hours: How many hours of history to look back (default 2)
        limit: Maximum number of readings to return (default 50)

    Returns:
        JSON string with telemetry readings sorted by timestamp descending.
    """
    db = get_db()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # The ingestion consumer stores truck_id or sensor_id depending on asset type
    query = {
        "$or": [
            {"truck_id": asset_id},
            {"sensor_id": asset_id},
            {"truck_id": {"$regex": asset_id, "$options": "i"}},
            {"sensor_id": {"$regex": asset_id, "$options": "i"}},
        ],
        "created_at": {"$gte": since}
    }

    cursor = db.telemetry.find(
        query, {"_id": 0}
    ).sort("created_at", -1).limit(limit)

    results = []
    for doc in cursor:
        for key in ["created_at", "timestamp"]:
            if key in doc and isinstance(doc[key], datetime):
                doc[key] = doc[key].isoformat()
        results.append(doc)

    if not results:
        return json.dumps({"message": f"No telemetry found for {asset_id} in last {hours}h"})

    return json.dumps(results, default=str)


def get_asset_state(asset_id: str) -> str:
    """Get the current digital twin state for an asset from MongoDB assets collection.

    Args:
        asset_id: The asset identifier

    Returns:
        JSON string with the current state from MongoDB.
    """
    db = get_db()

    # The ingestion consumer uses asset_id as _id in the assets collection
    state = db.assets.find_one({"_id": asset_id})

    if not state:
        # Try regex match
        state = db.assets.find_one({"_id": {"$regex": asset_id, "$options": "i"}})

    if not state:
        return json.dumps({"message": f"No asset state found for {asset_id}"})

    # Convert _id and datetime fields
    state["asset_id"] = state.pop("_id", asset_id)
    for key in ["last_updated"]:
        if key in state and isinstance(state[key], datetime):
            state[key] = state[key].isoformat()

    return json.dumps(state, default=str)


def find_breaches(asset_id: str = None, hours: int = 24, limit: int = 20) -> str:
    """Find temperature breach/alert events from MongoDB.

    Args:
        asset_id: Optional — filter by specific asset.
        hours: How many hours to look back (default 24)
        limit: Maximum results (default 20)

    Returns:
        JSON string with breach/alert events.
    """
    db = get_db()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Alerts are stored by the kafka_consumer with created_at timestamp
    # and have anomaly.type field (e.g. TEMP_BREACH, DOOR_OPEN)
    query = {"created_at": {"$gte": since}}
    if asset_id:
        query["asset_id"] = {"$regex": asset_id, "$options": "i"}

    cursor = db.alerts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)

    results = []
    for doc in cursor:
        for key in ["created_at", "detected_at"]:
            if key in doc and isinstance(doc[key], datetime):
                doc[key] = doc[key].isoformat()
        results.append(doc)

    if not results:
        scope = f"for {asset_id}" if asset_id else "across all assets"
        return json.dumps({"message": f"No alerts/breaches found {scope} in last {hours}h"})

    return json.dumps(results, default=str)