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