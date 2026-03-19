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
        """Get alerts from MongoDB"""
        try:
            since = datetime.now(timezone.utc) - timedelta(hours=hours)
            query = {"created_at": {"$gte": since}}
            
            if asset_id:
                query["asset_id"] = asset_id
            
            if acknowledged is not None:
                query["acknowledged"] = acknowledged
            
            cursor = self.db.alerts.find(
                query,
                {"_id": 0}
            ).sort("created_at", -1).limit(limit)
            
            return list(cursor)
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

    async def get_telemetry_history(self, asset_id: str, hours: int = 24, limit: int = 500):
        """Return temperature + humidity timeseries, oldest first."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        cursor = coll.find(
            {"asset_id": asset_id, "timestamp": {"$gte": cutoff}},
            {"_id": 0, "timestamp": 1, "temperature": 1, "humidity": 1},
            sort=[("timestamp", 1)],
        ).limit(limit)
        docs = await cursor.to_list(length=limit)
        for d in docs:
            if hasattr(d.get("timestamp"), "isoformat"):
                d["timestamp"] = d["timestamp"].isoformat()
        return docs

    async def get_door_events(self, asset_id: str, hours: int = 24):
        """
        Derive door open/close events from telemetry transitions.
        Returns list of {timestamp, event_type, duration_seconds}.
        """
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        cursor = coll.find(
            {"asset_id": asset_id, "timestamp": {"$gte": cutoff}},
            {"_id": 0, "timestamp": 1, "door_open": 1},
            sort=[("timestamp", 1)],
        )
        docs = await cursor.to_list(length=5000)
        events = []
        prev_open = None
        prev_ts = None
        for d in docs:
            cur_open = d.get("door_open", False)
            cur_ts = d.get("timestamp")
            if prev_open is not None and cur_open != prev_open:
                event_type = "open" if cur_open else "close"
                duration = 0
                if event_type == "close" and prev_ts:
                    try:
                        if hasattr(cur_ts, "timestamp"):
                            duration = int((cur_ts - prev_ts).total_seconds())
                    except Exception:
                        pass
                ts_str = cur_ts.isoformat() if hasattr(cur_ts, "isoformat") else str(cur_ts)
                events.append({"timestamp": ts_str, "event_type": event_type, "duration_seconds": duration})
            prev_open = cur_open
            prev_ts = cur_ts
        return events

    async def get_compressor_events(self, asset_id: str, hours: int = 24):
        """
        Derive compressor on/off events from telemetry transitions.
        Returns list of {timestamp, event_type, duration_seconds}.
        """
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        cursor = coll.find(
            {"asset_id": asset_id, "timestamp": {"$gte": cutoff}},
            {"_id": 0, "timestamp": 1, "compressor_on": 1},
            sort=[("timestamp", 1)],
        )
        docs = await cursor.to_list(length=5000)
        events = []
        prev_on = None
        prev_ts = None
        for d in docs:
            cur_on = d.get("compressor_on", True)
            cur_ts = d.get("timestamp")
            if prev_on is not None and cur_on != prev_on:
                event_type = "on" if cur_on else "off"
                duration = 0
                if event_type == "on" and prev_ts:
                    try:
                        if hasattr(cur_ts, "timestamp"):
                            duration = int((cur_ts - prev_ts).total_seconds())
                    except Exception:
                        pass
                ts_str = cur_ts.isoformat() if hasattr(cur_ts, "isoformat") else str(cur_ts)
                events.append({"timestamp": ts_str, "event_type": event_type, "duration_seconds": duration})
            prev_on = cur_on
            prev_ts = cur_ts
        return events

    async def get_location_history(self, asset_id: str, hours: int = 4, limit: int = 200):
        """Return GPS trail for trucks (lat/lng/speed/timestamp)."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["telemetry"]
        cursor = coll.find(
            {
                "asset_id": asset_id,
                "timestamp": {"$gte": cutoff},
                "latitude": {"$exists": True},
            },
            {"_id": 0, "timestamp": 1, "latitude": 1, "longitude": 1, "speed": 1},
            sort=[("timestamp", 1)],
        ).limit(limit)
        docs = await cursor.to_list(length=limit)
        for d in docs:
            if hasattr(d.get("timestamp"), "isoformat"):
                d["timestamp"] = d["timestamp"].isoformat()
        return docs

    async def get_asset_alerts(self, asset_id: str, hours: int = 24):
        """Return alert documents for a single asset, newest first."""
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        coll = self.db["alerts"]
        cursor = coll.find(
            {"asset_id": asset_id, "timestamp": {"$gte": cutoff}},
            {"_id": 0},
            sort=[("timestamp", -1)],
        ).limit(500)
        docs = await cursor.to_list(length=500)
        for d in docs:
            if hasattr(d.get("timestamp"), "isoformat"):
                d["timestamp"] = d["timestamp"].isoformat()
        return docs
