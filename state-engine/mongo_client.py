"""
MongoDB Client - For historical queries
"""

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from pymongo import MongoClient

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongodb:27017")
MONGO_DB = os.getenv("MONGO_DB", "coldchain")


class MongoDBClient:
    def __init__(self):
        self.client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        self.db = self.client[MONGO_DB]
        logger.info(f"Connected to MongoDB at {MONGO_URI}")
    
    def ping(self) -> bool:
        """Check MongoDB connection"""
        try:
            self.client.admin.command('ping')
            return True
        except Exception as e:
            logger.error(f"MongoDB ping failed: {e}")
            return False
    
    def get_asset_history(
        self, 
        asset_id: str, 
        hours: int = 24,
        limit: int = 1000
    ) -> List[dict]:
        """Get historical telemetry for an asset"""
        try:
            since = datetime.now(timezone.utc) - timedelta(hours=hours)
            
            # Check if truck or room
            query = {
                "$or": [
                    {"truck_id": asset_id},
                    {"sensor_id": asset_id}
                ],
                "created_at": {"$gte": since}
            }
            
            cursor = self.db.telemetry.find(
                query,
                {"_id": 0}
            ).sort("created_at", -1).limit(limit)
            
            return list(cursor)
        except Exception as e:
            logger.error(f"Failed to get asset history: {e}")
            return []
    
    def get_alerts(
        self,
        asset_id: Optional[str] = None,
        hours: int = 24,
        acknowledged: Optional[bool] = None,
        limit: int = 100
    ) -> List[dict]:
        """Get alerts from MongoDB — deduplicated by asset_id + anomaly type."""
        try:
            since = datetime.now(timezone.utc) - timedelta(hours=hours)
            query = {"created_at": {"$gte": since}}

            if asset_id:
                query["asset_id"] = asset_id

            if acknowledged is not None:
                query["acknowledged"] = acknowledged

            # Aggregate: latest alert per asset_id + anomaly.type
            pipeline = [
                {"$match": query},
                {"$sort": {"created_at": -1}},
                {"$group": {
                    "_id": {
                        "asset_id": "$asset_id",
                        "type": "$anomaly.type"
                    },
                    "doc": {"$first": "$$ROOT"}
                }},
                {"$replaceRoot": {"newRoot": "$doc"}},
                {"$sort": {"created_at": -1}},
                {"$limit": limit},
                {"$project": {"_id": 0}},
            ]

            docs = list(self.db.alerts.aggregate(pipeline))
            # Serialize datetimes
            for d in docs:
                for key in ["created_at", "detected_at"]:
                    if hasattr(d.get(key), "isoformat"):
                        d[key] = d[key].isoformat()
            return docs
        except Exception as e:
            logger.error(f"Failed to get alerts: {e}")
            return []
    
    def acknowledge_alert(self, alert_id: str) -> bool:
        """Mark alert as acknowledged"""
        try:
            from bson import ObjectId
            result = self.db.alerts.update_one(
                {"_id": ObjectId(alert_id)},
                {"$set": {"acknowledged": True, "acknowledged_at": datetime.now(timezone.utc)}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Failed to acknowledge alert: {e}")
            return False
    # ── History / Detail helpers (called by new endpoints) ────────────────

    def get_telemetry_history(self, asset_id: str, hours: int = 24, limit: int = 500):
        """Return temperature + humidity timeseries, oldest first."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        query = {
            "$or": [
                {"truck_id": asset_id},
                {"sensor_id": asset_id},
            ],
            "created_at": {"$gte": cutoff},
        }
        docs = list(coll.find(
            query,
            {"_id": 0, "created_at": 1, "temperature_c": 1, "humidity_pct": 1},
            sort=[("created_at", 1)],
        ).limit(limit))
        for d in docs:
            if hasattr(d.get("created_at"), "isoformat"):
                dt = d.pop("created_at")
                d["timestamp"] = dt.isoformat() + ("Z" if dt.tzinfo is None else "")
            if "temperature_c" in d:
                d["temperature"] = d.pop("temperature_c")
            if "humidity_pct" in d:
                d["humidity"] = d.pop("humidity_pct")
        return docs

    def get_door_events(self, asset_id: str, hours: int = 24):
        """Derive door open/close events from telemetry transitions."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        query = {
            "$or": [{"truck_id": asset_id}, {"sensor_id": asset_id}],
            "created_at": {"$gte": cutoff},
        }
        docs = list(coll.find(
            query,
            {"_id": 0, "created_at": 1, "door_open": 1},
            sort=[("created_at", 1)],
        ))
        events = []
        prev_open, prev_ts = None, None
        for d in docs:
            cur_open = d.get("door_open", False)
            cur_ts = d.get("created_at")
            if prev_open is not None and cur_open != prev_open:
                event_type = "open" if cur_open else "close"
                duration = 0
                if event_type == "close" and prev_ts and cur_ts:
                    try:
                        duration = int((cur_ts - prev_ts).total_seconds())
                    except Exception:
                        pass
                ts_str = cur_ts.isoformat() if hasattr(cur_ts, "isoformat") else str(cur_ts)
                events.append({"timestamp": ts_str, "event_type": event_type, "duration_seconds": duration})
            prev_open = cur_open
            prev_ts = cur_ts
        return events

    def get_compressor_events(self, asset_id: str, hours: int = 24):
        """Derive compressor on/off events from telemetry transitions."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        query = {
            "$or": [{"truck_id": asset_id}, {"sensor_id": asset_id}],
            "created_at": {"$gte": cutoff},
        }
        docs = list(coll.find(
            query,
            {"_id": 0, "created_at": 1, "compressor_running": 1},
            sort=[("created_at", 1)],
        ))
        events = []
        prev_on, prev_ts = None, None
        for d in docs:
            cur_on = d.get("compressor_running", True)
            cur_ts = d.get("created_at")
            if prev_on is not None and cur_on != prev_on:
                event_type = "on" if cur_on else "off"
                duration = 0
                if event_type == "on" and prev_ts and cur_ts:
                    try:
                        duration = int((cur_ts - prev_ts).total_seconds())
                    except Exception:
                        pass
                ts_str = cur_ts.isoformat() if hasattr(cur_ts, "isoformat") else str(cur_ts)
                events.append({"timestamp": ts_str, "event_type": event_type, "duration_seconds": duration})
            prev_on = cur_on
            prev_ts = cur_ts
        return events

    def get_location_history(self, asset_id: str, hours: int = 4, limit: int = 200):
        """Return GPS trail for trucks."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        query = {
            "truck_id": asset_id,
            "created_at": {"$gte": cutoff},
            "latitude": {"$exists": True},
        }
        docs = list(coll.find(
            query,
            {"_id": 0, "created_at": 1, "latitude": 1, "longitude": 1, "speed_kmh": 1},
            sort=[("created_at", 1)],
        ).limit(limit))
        for d in docs:
            if hasattr(d.get("created_at"), "isoformat"):
                dt = d.pop("created_at")
                d["timestamp"] = dt.isoformat() + ("Z" if dt.tzinfo is None else "")
            if "speed_kmh" in d:
                d["speed"] = d.pop("speed_kmh")
        return docs

    def get_asset_alerts(self, asset_id: str, hours: int = 24):
        """Return alert documents for a single asset, newest first."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["alerts"]
        docs = list(coll.find(
            {"asset_id": asset_id, "created_at": {"$gte": cutoff}},
            {"_id": 0},
            sort=[("created_at", -1)],
        ).limit(500))
        for d in docs:
            for key in ["created_at", "detected_at"]:
                if hasattr(d.get(key), "isoformat"):
                    d[key] = d[key].isoformat()
            if "anomaly" in d and "severity" not in d:
                d["severity"] = d["anomaly"].get("severity", "INFO")
            if "anomaly" in d and "message" not in d:
                d["message"] = d["anomaly"].get("message", d["anomaly"].get("type", "Alert"))
            if "created_at" in d and "timestamp" not in d:
                d["timestamp"] = d["created_at"]
        return docs
