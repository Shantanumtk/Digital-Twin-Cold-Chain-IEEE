"""
Cold Chain Digital Twin - State Engine (Phase 4 patched)
FastAPI REST API + Kafka Consumer

Phase 4 additions:
  - trace_id passthrough from MQTT publish → Redis state
  - publish_ts_ms for end-to-end latency measurement
  - /metrics endpoint: p50/p95/p99 rolling buffer
  - /ingest endpoint: direct telemetry for dataset_eval.py (Phase 3)
  - /evaluate endpoint: stateless evaluation for dataset_eval.py
"""

import os
import json
import logging
import asyncio
import statistics
import uuid
import time
from threading import Thread
from collections import deque
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager
from enum import Enum

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from confluent_kafka import Consumer

from state_calculator import StateCalculator
try:
    from sns_publisher import publish_critical_alert
except Exception:
    def publish_critical_alert(*a, **k): pass
from profile_loader import get_profile_summary, reload_profile
from redis_client import RedisClient
from mongo_client import MongoDBClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_GROUP_ID          = os.getenv("KAFKA_GROUP_ID",          "state-engine")
KAFKA_TOPICS            = os.getenv("KAFKA_TOPICS",
    "coldchain.telemetry.trucks,coldchain.telemetry.rooms,coldchain.alerts")

redis_client = RedisClient()
mongo_client = MongoDBClient()

# Phase 4: Rolling latency buffer (last 1000 trace measurements in ms)
_latency_buffer: deque = deque(maxlen=1000)

kafka_consumer_running = False


# =============================================================================
# Kafka Consumer (Background Thread)
# =============================================================================

def kafka_consumer_thread():
    global kafka_consumer_running

    consumer_config = {
        'bootstrap.servers': KAFKA_BOOTSTRAP_SERVERS,
        'group.id':          KAFKA_GROUP_ID,
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
    """Process telemetry and update state. Phase 4: trace_id + latency tracking."""
    t_received_ms = time.time() * 1000  # wall-clock ms at receipt

    asset_id = telemetry.get("truck_id") or telemetry.get("sensor_id")
    if not asset_id:
        return

    trace_id = telemetry.get("trace_id")  # Phase 4: injected by simulator

    state_result = StateCalculator.calculate_state(telemetry)

    state_doc = {
        "asset_type":         telemetry.get("asset_type"),
        "state":              state_result["state"],
        "reasons":            state_result["reasons"],
        "temperature_c":      telemetry.get("temperature_c"),
        "humidity_pct":       telemetry.get("humidity_pct"),
        "door_open":          telemetry.get("door_open"),
        "compressor_running": telemetry.get("compressor_running"),
        "mqtt_topic":         telemetry.get("mqtt_topic"),
        "last_telemetry_at":  telemetry.get("timestamp"),
        "trace_id":           trace_id,  # Phase 4
    }

    if telemetry.get("latitude") and telemetry.get("longitude"):
        state_doc["location"] = {
            "latitude":  telemetry.get("latitude"),
            "longitude": telemetry.get("longitude"),
            "speed_kmh": telemetry.get("speed_kmh"),
        }

    previous       = redis_client.get_asset_state(asset_id) or {}
    previous_state = previous.get("state", "NORMAL")

    redis_client.set_asset_state(asset_id, state_doc)

    # Phase 4: record end-to-end latency if simulator included publish_ts_ms
    publish_ts_ms = telemetry.get("publish_ts_ms")
    if publish_ts_ms:
        e2e_ms = t_received_ms - float(publish_ts_ms)
        if 0 < e2e_ms < 60_000:  # sanity check: must be positive and < 60s
            _latency_buffer.append(e2e_ms)

    current_state = state_result["state"]

    if current_state in ["WARNING", "CRITICAL"]:
        if previous_state != current_state:
            redis_client.set_active_alert(asset_id, {
                "state":         current_state,
                "reasons":       state_result["reasons"],
                "temperature_c": telemetry.get("temperature_c"),
            })
            if current_state == "CRITICAL":
                try:
                    publish_critical_alert(
                        asset_id=asset_id,
                        alert_type="STATE_TRANSITION",
                        message="; ".join(state_result["reasons"]),
                    )
                    logger.info(f"SNS alert sent for {asset_id}")
                except Exception as sns_err:
                    logger.error(f"SNS publish error for {asset_id}: {sns_err}")
    else:
        redis_client.clear_alert(asset_id)


def process_alert(alert: dict):
    asset_id = alert.get("asset_id")
    if asset_id:
        redis_client.set_active_alert(asset_id, alert)


# =============================================================================
# Lifespan & FastAPI App
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    thread = Thread(target=kafka_consumer_thread, daemon=True)
    thread.start()
    logger.info("State Engine started")
    yield
    global kafka_consumer_running
    kafka_consumer_running = False
    logger.info("State Engine shutting down")


app = FastAPI(
    title="Cold Chain Digital Twin - State Engine",
    description="Real-time asset state and REST API",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AssetStateFilter(str, Enum):
    NORMAL   = "NORMAL"
    WARNING  = "WARNING"
    CRITICAL = "CRITICAL"


class AssetTypeFilter(str, Enum):
    TRUCK     = "refrigerated_truck"
    COLD_ROOM = "cold_room"


class HealthResponse(BaseModel):
    status:         str
    redis:          bool
    mongodb:        bool
    kafka_consumer: bool
    timestamp:      str


class AssetState(BaseModel):
    asset_id:           str
    asset_type:         Optional[str] = None
    state:              str
    reasons:            List[str] = []
    temperature_c:      Optional[float] = None
    humidity_pct:       Optional[float] = None
    door_open:          Optional[bool]  = None
    compressor_running: Optional[bool]  = None
    location:           Optional[dict]  = None
    updated_at:         Optional[str]   = None


class StatsResponse(BaseModel):
    total_assets:  int
    state_counts:  dict
    asset_types:   dict
    active_alerts: int
    updated_at:    str


# =============================================================================
# REST API Endpoints
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status         = "healthy",
        redis          = redis_client.ping(),
        mongodb        = mongo_client.ping(),
        kafka_consumer = kafka_consumer_running,
        timestamp      = datetime.now(timezone.utc).isoformat()
    )


@app.get("/assets", response_model=List[AssetState])
async def get_all_assets(
    state:      Optional[AssetStateFilter] = Query(None),
    asset_type: Optional[AssetTypeFilter]  = Query(None),
):
    assets = redis_client.get_all_assets()
    if state:
        assets = [a for a in assets if a.get("state") == state.value]
    if asset_type:
        assets = [a for a in assets if a.get("asset_type") == asset_type.value]
    return assets


@app.get("/assets/{asset_id}", response_model=AssetState)
async def get_asset(asset_id: str):
    state = redis_client.get_asset_state(asset_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found")
    state["asset_id"] = asset_id
    return state


@app.get("/assets/{asset_id}/history")
async def get_asset_history(
    asset_id: str,
    hours: int = Query(24, ge=1, le=168)
):
    history = mongo_client.get_asset_history(asset_id, hours=hours)
    return {"asset_id": asset_id, "hours": hours, "count": len(history), "telemetry": history}


@app.get("/alerts")
async def get_alerts(
    asset_id:    Optional[str] = None,
    active_only: bool = Query(False),
    hours:       int  = Query(24, ge=1, le=168),
):
    if active_only:
        alerts = redis_client.get_active_alerts()
        if asset_id:
            alerts = [a for a in alerts if a.get("asset_id") == asset_id]
        return {"active": True, "count": len(alerts), "alerts": alerts}
    alerts = mongo_client.get_alerts(asset_id=asset_id, hours=hours)
    return {"active": False, "hours": hours, "count": len(alerts), "alerts": alerts}


@app.get("/alerts/active")
async def get_active_alerts():
    alerts = redis_client.get_active_alerts()
    return {"count": len(alerts), "alerts": alerts}


@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    stats = redis_client.get_stats()
    if not stats:
        raise HTTPException(status_code=500, detail="Failed to get stats")
    return stats


@app.get("/profile")
async def get_active_profile():
    return get_profile_summary()


@app.post("/profile/reload")
async def reload_active_profile():
    profile = reload_profile()
    return {"message": "Profile reloaded", "name": profile.get("name", "unknown")}


# =============================================================================
# Phase 4: Latency Metrics Endpoint
# =============================================================================

@app.get("/metrics")
async def get_latency_metrics():
    """
    Phase 4: p50/p95/p99 latency metrics from rolling 1000-sample buffer.
    Measures end-to-end latency: MQTT publish_ts_ms → state stored in Redis.
    Used by eval/scale_test.py to produce paper Table 3.
    """
    buf = list(_latency_buffer)
    if not buf:
        return {
            "latency_p50_ms":  None,
            "latency_p95_ms":  None,
            "latency_p99_ms":  None,
            "latency_mean_ms": None,
            "sample_count":    0,
        }
    buf_sorted = sorted(buf)
    n = len(buf_sorted)
    return {
        "latency_p50_ms":  round(buf_sorted[int(n * 0.50)], 2),
        "latency_p95_ms":  round(buf_sorted[int(n * 0.95)], 2),
        "latency_p99_ms":  round(buf_sorted[int(n * 0.99)], 2),
        "latency_mean_ms": round(statistics.mean(buf), 2),
        "sample_count":    n,
    }


# =============================================================================
# Phase 3: Dataset Eval Endpoints
# =============================================================================

@app.post("/ingest")
async def ingest_telemetry(payload: dict):
    """
    Phase 3: Direct telemetry ingestion (bypasses Kafka).
    Used by eval/dataset_eval.py to replay CSV rows.
    The state engine treats this identically to live sensor data.
    Returns computed state.
    """
    asset_id = payload.get("truck_id") or payload.get("sensor_id")
    if not asset_id:
        raise HTTPException(status_code=400, detail="Missing truck_id or sensor_id")

    # Route through process_telemetry() so SNS fires on NORMAL->CRITICAL transitions
    process_telemetry(payload)
    state_result = StateCalculator.calculate_state(payload)
    return {
        "asset_id": asset_id,
        "state":    state_result["state"],
        "reasons":  state_result["reasons"],
    }


@app.post("/evaluate")
async def evaluate_telemetry(payload: dict):
    """
    Stateless evaluation — computes state but does NOT persist to Redis.
    Used by dataset_eval.py for pure accuracy measurement without polluting live state.
    """
    state_result = StateCalculator.calculate_state(payload)
    return {
        "state":   state_result["state"],
        "reasons": state_result["reasons"],
    }


# =============================================================================
# Asset History / Detail Endpoints (Dashboard Modal)
# =============================================================================

@app.get("/assets/{asset_id}/telemetry")
async def get_asset_telemetry(
    asset_id: str,
    hours:    int = Query(default=24,  ge=1, le=168),
    limit:    int = Query(default=500, ge=10, le=2000),
):
    try:
        docs = mongo_client.get_telemetry_history(asset_id, hours=hours, limit=limit)
        return {"asset_id": asset_id, "hours": hours, "count": len(docs), "data": docs}
    except Exception as e:
        logger.error(f"telemetry history error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{asset_id}/door-activity")
async def get_door_activity(
    asset_id: str,
    hours:    int = Query(default=24, ge=1, le=168),
):
    try:
        events = mongo_client.get_door_events(asset_id, hours=hours)
        total_open_seconds = sum(
            e.get("duration_seconds", 0) for e in events if e.get("event_type") == "close"
        )
        return {
            "asset_id":          asset_id,
            "hours":             hours,
            "total_open_seconds":total_open_seconds,
            "open_count":        sum(1 for e in events if e.get("event_type") == "open"),
            "events":            events,
        }
    except Exception as e:
        logger.error(f"door-activity error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{asset_id}/compressor-activity")
async def get_compressor_activity(
    asset_id: str,
    hours:    int = Query(default=24, ge=1, le=168),
):
    try:
        events          = mongo_client.get_compressor_events(asset_id, hours=hours)
        on_seconds      = sum(e.get("duration_seconds", 0) for e in events if e.get("event_type") == "off")
        window_seconds  = hours * 3600
        runtime_pct     = round((on_seconds / window_seconds) * 100, 1) if window_seconds > 0 else 0
        return {
            "asset_id":       asset_id,
            "hours":          hours,
            "runtime_percent":runtime_pct,
            "cycle_count":    sum(1 for e in events if e.get("event_type") == "on"),
            "events":         events,
        }
    except Exception as e:
        logger.error(f"compressor-activity error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{asset_id}/location-history")
async def get_location_history(
    asset_id: str,
    hours:    int = Query(default=4,   ge=1, le=48),
    limit:    int = Query(default=200, ge=10, le=1000),
):
    try:
        points = mongo_client.get_location_history(asset_id, hours=hours, limit=limit)
        return {"asset_id": asset_id, "hours": hours, "count": len(points), "route": points}
    except Exception as e:
        logger.error(f"location-history error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{asset_id}/alert-history")
async def get_asset_alert_history(
    asset_id: str,
    hours:    int = Query(default=24, ge=1, le=168),
):
    try:
        alerts = mongo_client.get_asset_alerts(asset_id, hours=hours)
        severity_counts: dict = {}
        for a in alerts:
            sev = a.get("severity", "UNKNOWN")
            severity_counts[sev] = severity_counts.get(sev, 0) + 1
        return {
            "asset_id":          asset_id,
            "hours":             hours,
            "total":             len(alerts),
            "severity_breakdown":severity_counts,
            "alerts":            alerts,
        }
    except Exception as e:
        logger.error(f"alert-history error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{asset_id}/config")
async def get_asset_config(asset_id: str):
    try:
        state = redis_client.get_asset_state(asset_id)
        if not state:
            raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found")
        profile    = get_profile_summary()
        asset_type = state.get("asset_type", "truck")
        thresholds = profile.get("thresholds", {}).get(asset_type, {})
        return {
            "asset_id":    asset_id,
            "asset_type":  asset_type,
            "profile_name":profile.get("name", "default"),
            "thresholds":  thresholds,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"config error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/assets/{asset_id}/summary")
async def get_asset_summary(
    asset_id: str,
    hours:    int = Query(default=24, ge=1, le=168),
):
    try:
        state = redis_client.get_asset_state(asset_id)
        if not state:
            raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found")
        telemetry  = mongo_client.get_telemetry_history(asset_id, hours=hours, limit=2000)
        raw_temps  = [t.get("temperature") or t.get("temperature_c") for t in telemetry]
        temps      = [t for t in raw_temps if t is not None]
        alert_docs = mongo_client.get_asset_alerts(asset_id, hours=hours)
        return {
            "asset_id":         asset_id,
            "current_state":    state.get("state", "UNKNOWN"),
            "current_temperature":state.get("temperature_c"),
            "current_humidity": state.get("humidity_pct"),
            "door_open":        state.get("door_open", False),
            "compressor_on":    state.get("compressor_running", True),
            "temperature_stats":{
                "min":     round(min(temps), 2) if temps else None,
                "max":     round(max(temps), 2) if temps else None,
                "avg":     round(sum(temps) / len(temps), 2) if temps else None,
                "samples": len(temps),
            },
            "alert_count_24h":  len(alert_docs),
            "last_updated":     state.get("updated_at"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"summary error for {asset_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
