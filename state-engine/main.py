"""
Cold Chain Digital Twin - State Engine
FastAPI REST API + Kafka Consumer
"""

import os
import json
import logging
import asyncio
from threading import Thread
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager
from enum import Enum

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from confluent_kafka import Consumer

from state_calculator import StateCalculator
from profile_loader import get_profile_summary, reload_profile
from redis_client import RedisClient
from mongo_client import MongoDBClient

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "state-engine")
KAFKA_TOPICS = os.getenv("KAFKA_TOPICS", "coldchain.telemetry.trucks,coldchain.telemetry.rooms,coldchain.alerts")

# Initialize clients
redis_client = RedisClient()
mongo_client = MongoDBClient()


# =============================================================================
# Kafka Consumer (Background Thread)
# =============================================================================

kafka_consumer_running = False


def kafka_consumer_thread():
    """Background thread to consume Kafka messages"""
    global kafka_consumer_running

    consumer_config = {
        'bootstrap.servers': KAFKA_BOOTSTRAP_SERVERS,
        'group.id': KAFKA_GROUP_ID,
        'auto.offset.reset': 'latest',
        'enable.auto.commit': True,
    }

    consumer = Consumer(consumer_config)
    consumer.subscribe(KAFKA_TOPICS.split(','))

    logger.info("Kafka consumer started")
    kafka_consumer_running = True

    message_count = 0

    try:
        while kafka_consumer_running:
            msg = consumer.poll(1.0)

            if msg is None:
                continue
            if msg.error():
                logger.error(f"Consumer error: {msg.error()}")
                continue

            try:
                topic = msg.topic()
                value = json.loads(msg.value().decode('utf-8'))

                if topic == "coldchain.alerts":
                    process_alert(value)
                else:
                    process_telemetry(value)

                message_count += 1
                if message_count % 500 == 0:
                    logger.info(f"State Engine processed {message_count} messages")

            except Exception as e:
                logger.error(f"Processing error: {e}")

    except Exception as e:
        logger.error(f"Kafka consumer error: {e}")
    finally:
        consumer.close()
        kafka_consumer_running = False


def process_telemetry(telemetry: dict):
    """Process telemetry and update state"""
    asset_id = telemetry.get("truck_id") or telemetry.get("sensor_id")
    if not asset_id:
        return

    # Calculate state
    state_result = StateCalculator.calculate_state(telemetry)

    # Build state document
    state_doc = {
        "asset_type": telemetry.get("asset_type"),
        "state": state_result["state"],
        "reasons": state_result["reasons"],
        "temperature_c": telemetry.get("temperature_c"),
        "humidity_pct": telemetry.get("humidity_pct"),
        "door_open": telemetry.get("door_open"),
        "compressor_running": telemetry.get("compressor_running"),
        "mqtt_topic": telemetry.get("mqtt_topic"),
        "last_telemetry_at": telemetry.get("timestamp")
    }

    # Add location for trucks
    if telemetry.get("latitude") and telemetry.get("longitude"):
        state_doc["location"] = {
            "latitude": telemetry.get("latitude"),
            "longitude": telemetry.get("longitude"),
            "speed_kmh": telemetry.get("speed_kmh")
        }

    # Store in Redis
    redis_client.set_asset_state(asset_id, state_doc)

    # Handle alerts
    if state_result["state"] in ["WARNING", "CRITICAL"]:
        redis_client.set_active_alert(asset_id, {
            "state": state_result["state"],
            "reasons": state_result["reasons"],
            "temperature_c": telemetry.get("temperature_c")
        })
    else:
        redis_client.clear_alert(asset_id)


def process_alert(alert: dict):
    """Process alert from Kafka"""
    asset_id = alert.get("asset_id")
    if asset_id:
        redis_client.set_active_alert(asset_id, alert)


# =============================================================================
# Lifespan & FastAPI App
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    thread = Thread(target=kafka_consumer_thread, daemon=True)
    thread.start()
    logger.info("State Engine started")
    yield
    # Shutdown
    global kafka_consumer_running
    kafka_consumer_running = False
    logger.info("State Engine shutting down")


app = FastAPI(
    title="Cold Chain Digital Twin - State Engine",
    description="Real-time asset state and REST API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Enums for Input Validation
# =============================================================================

class AssetStateFilter(str, Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class AssetTypeFilter(str, Enum):
    TRUCK = "refrigerated_truck"
    COLD_ROOM = "cold_room"


# =============================================================================
# Pydantic Models
# =============================================================================

class HealthResponse(BaseModel):
    status: str
    redis: bool
    mongodb: bool
    kafka_consumer: bool
    timestamp: str


class AssetState(BaseModel):
    asset_id: str
    asset_type: Optional[str] = None
    state: str
    reasons: List[str] = []
    temperature_c: Optional[float] = None
    humidity_pct: Optional[float] = None
    door_open: Optional[bool] = None
    compressor_running: Optional[bool] = None
    location: Optional[dict] = None
    updated_at: Optional[str] = None


class StatsResponse(BaseModel):
    total_assets: int
    state_counts: dict
    asset_types: dict
    active_alerts: int
    updated_at: str


# =============================================================================
# REST API Endpoints
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        redis=redis_client.ping(),
        mongodb=mongo_client.ping(),
        kafka_consumer=kafka_consumer_running,
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@app.get("/assets", response_model=List[AssetState])
async def get_all_assets(
    state: Optional[AssetStateFilter] = Query(None, description="Filter by state"),
    asset_type: Optional[AssetTypeFilter] = Query(None, description="Filter by type"),
):
    """Get all assets with current state"""
    assets = redis_client.get_all_assets()

    if state:
        assets = [a for a in assets if a.get("state") == state.value]

    if asset_type:
        assets = [a for a in assets if a.get("asset_type") == asset_type.value]

    return assets


@app.get("/assets/{asset_id}", response_model=AssetState)
async def get_asset(asset_id: str):
    """Get current state for a specific asset"""
    state = redis_client.get_asset_state(asset_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found")
    state["asset_id"] = asset_id
    return state


@app.get("/assets/{asset_id}/history")
async def get_asset_history(
    asset_id: str,
    hours: int = Query(24, ge=1, le=168, description="Hours of history (1-168)")
):
    """Get historical telemetry for an asset"""
    history = mongo_client.get_asset_history(asset_id, hours=hours)
    return {
        "asset_id": asset_id,
        "hours": hours,
        "count": len(history),
        "telemetry": history
    }


@app.get("/alerts")
async def get_alerts(
    asset_id: Optional[str] = None,
    active_only: bool = Query(False, description="Only return active alerts"),
    hours: int = Query(24, ge=1, le=168)
):
    """Get alerts"""
    if active_only:
        alerts = redis_client.get_active_alerts()
        if asset_id:
            alerts = [a for a in alerts if a.get("asset_id") == asset_id]
        return {"active": True, "count": len(alerts), "alerts": alerts}
    else:
        alerts = mongo_client.get_alerts(asset_id=asset_id, hours=hours)
        return {"active": False, "hours": hours, "count": len(alerts), "alerts": alerts}


@app.get("/alerts/active")
async def get_active_alerts():
    """Get currently active alerts"""
    alerts = redis_client.get_active_alerts()
    return {
        "count": len(alerts),
        "alerts": alerts
    }


@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    """Get dashboard statistics"""
    stats = redis_client.get_stats()
    if not stats:
        raise HTTPException(status_code=500, detail="Failed to get stats")
    return stats




@app.get("/profile")
async def get_active_profile():
    """Get the currently active profile configuration."""
    return get_profile_summary()


@app.post("/profile/reload")
async def reload_active_profile():
    """Reload the active profile from disk."""
    profile = reload_profile()
    return {"message": "Profile reloaded", "name": profile.get("name", "unknown")}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)