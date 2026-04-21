#!/usr/bin/env python3
"""
eval/scale_test.py — Scale test on EKS.

Runs simulator at N=10/50/100/500 assets for 10 minutes each.
Records avg p99, max p99, and Kafka consumer lag at each load level.

Produces paper Table 3 data.

Prerequisites (run once before this script):
  # Increase Kafka partitions:
  kubectl exec -n coldchain kafka-0 -- kafka-topics.sh \
    --alter --topic coldchain.telemetry.trucks --partitions 5 \
    --bootstrap-server localhost:9092

  kubectl exec -n coldchain kafka-0 -- kafka-topics.sh \
    --alter --topic coldchain.telemetry.rooms --partitions 5 \
    --bootstrap-server localhost:9092

  # Scale state engine:
  kubectl scale deployment state-engine --replicas=3 -n coldchain

Usage:
  STATE_ENGINE_URL=http://<lb> MQTT_BROKER=<ip> python eval/scale_test.py
"""

import os
import json
import time
import logging
import statistics
import subprocess
from datetime import datetime, timezone

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

STATE_ENGINE_URL   = os.getenv("STATE_ENGINE_URL",  "http://localhost:8000")
KAFKA_BOOTSTRAP    = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
MQTT_BROKER        = os.getenv("MQTT_BROKER",        "localhost")
RESULTS_FILE       = os.path.join(os.path.dirname(__file__), "scale_test_results.json")

# Table 3 load levels: 10, 50, 100, 500 assets
# Each asset publishes 8 sensor streams (temp, humidity, door, compressor, GPS x4)
LOAD_LEVELS = [
    {"assets": 10,  "trucks": 8,  "rooms": 2,  "duration_sec": 600, "streams": 80},
    {"assets": 50,  "trucks": 40, "rooms": 10, "duration_sec": 600, "streams": 400},
    {"assets": 100, "trucks": 80, "rooms": 20, "duration_sec": 600, "streams": 800},
    {"assets": 500, "trucks": 400,"rooms": 100,"duration_sec": 600, "streams": 4000},
]

METRICS_POLL_INTERVAL = 10  # seconds between /metrics polls during test
WARMUP_SEC = 30             # warmup before recording metrics


def get_metrics(url: str) -> dict:
    """Fetch latency metrics from state engine /metrics endpoint."""
    try:
        resp = requests.get(f"{url}/metrics", timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.debug(f"Metrics fetch failed: {e}")
        return {}


def get_kafka_lag() -> dict:
    """
    Measure Kafka consumer lag using kafka-consumer-groups.sh.
    Returns dict with lag per topic.
    """
    try:
        result = subprocess.run(
            [
                "kubectl", "exec", "-n", "coldchain", "kafka-0", "--",
                "kafka-consumer-groups.sh",
                "--bootstrap-server", "localhost:9092",
                "--describe",
                "--group", "state-engine",
            ],
            capture_output=True, text=True, timeout=30,
        )
        lag_total = 0
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 6 and parts[0] not in ("GROUP", "CONSUMER"):
                try:
                    lag = int(parts[5])
                    lag_total += lag
                except (ValueError, IndexError):
                    pass
        return {"total_lag": lag_total}
    except Exception as e:
        logger.debug(f"Kafka lag check failed: {e}")
        return {"total_lag": -1}


def set_fleet_size(trucks: int, rooms: int):
    """
    Update simulator environment via kubectl or docker.
    For EKS: restart simulator with new fleet size.
    """
    logger.info(f"Setting fleet: {trucks} trucks, {rooms} cold rooms")

    # Try kubectl first (EKS)
    try:
        subprocess.run([
            "kubectl", "set", "env", "deployment/simulator",
            "-n", "coldchain",
            f"NUM_TRUCKS={trucks}",
            f"NUM_COLD_ROOMS={rooms}",
            "PUBLISH_INTERVAL=2.0",
        ], check=True, timeout=30, capture_output=True)
        subprocess.run([
            "kubectl", "rollout", "restart", "deployment/simulator",
            "-n", "coldchain",
        ], check=True, timeout=30, capture_output=True)
        logger.info("Restarted simulator via kubectl")
        return True
    except Exception:
        pass

    # Fallback: docker (local eval)
    try:
        subprocess.run([
            "docker", "stop", "cc-eval-simulator",
        ], capture_output=True)
        subprocess.run([
            "docker", "run", "-d",
            "--name", "cc-eval-simulator",
            "--network", "eval_coldchain-eval",
            "-e", f"MQTT_BROKER={MQTT_BROKER}",
            "-e", f"NUM_TRUCKS={trucks}",
            "-e", f"NUM_COLD_ROOMS={rooms}",
            "-e", "PUBLISH_INTERVAL=2.0",
            "coldchain-sensor-simulator",
        ], check=True, capture_output=True)
        logger.info("Restarted simulator via docker")
        return True
    except Exception as e:
        logger.warning(f"Could not restart simulator: {e}")
        return False


def run_load_level(level: dict) -> dict:
    """
    Run one load level for duration_sec seconds.
    Returns latency and throughput metrics.
    """
    n      = level["assets"]
    trucks = level["trucks"]
    rooms  = level["rooms"]
    dur    = level["duration_sec"]
    streams= level["streams"]

    logger.info(f"\n{'='*60}")
    logger.info(f"Load level: {n} assets ({trucks} trucks + {rooms} rooms) = {streams} streams")
    logger.info(f"Duration: {dur}s")
    logger.info(f"{'='*60}")

    # Set fleet size
    set_fleet_size(trucks, rooms)

    # Warmup
    logger.info(f"Warming up {WARMUP_SEC}s...")
    time.sleep(WARMUP_SEC)

    # Collect metrics
    p99_samples = []
    p95_samples = []
    lag_samples = []

    test_start = time.time()
    while time.time() - test_start < (dur - WARMUP_SEC):
        m = get_metrics(STATE_ENGINE_URL)
        if m.get("latency_p99_ms") is not None:
            p99_samples.append(m["latency_p99_ms"])
        if m.get("latency_p95_ms") is not None:
            p95_samples.append(m["latency_p95_ms"])

        lag = get_kafka_lag()
        lag_samples.append(lag.get("total_lag", 0))

        elapsed = time.time() - test_start
        logger.info(
            f"t={elapsed:.0f}s | "
            f"p99={m.get('latency_p99_ms','N/A')}ms | "
            f"p95={m.get('latency_p95_ms','N/A')}ms | "
            f"kafka_lag={lag.get('total_lag','N/A')}"
        )
        time.sleep(METRICS_POLL_INTERVAL)

    # Summarize
    def safe_stat(lst, fn):
        lst_clean = [x for x in lst if x is not None and x >= 0]
        return round(fn(lst_clean), 2) if lst_clean else None

    result = {
        "assets":        n,
        "trucks":        trucks,
        "rooms":         rooms,
        "sensor_streams":streams,
        "duration_sec":  dur,
        "p99_avg_ms":    safe_stat(p99_samples, statistics.mean),
        "p99_max_ms":    safe_stat(p99_samples, max),
        "p95_avg_ms":    safe_stat(p95_samples, statistics.mean),
        "kafka_lag_avg": safe_stat(lag_samples, statistics.mean),
        "kafka_lag_max": safe_stat(lag_samples, max),
        "samples":       len(p99_samples),
    }

    logger.info(
        f"Level {n} done: p99_avg={result['p99_avg_ms']}ms "
        f"p99_max={result['p99_max_ms']}ms "
        f"kafka_lag_avg={result['kafka_lag_avg']}"
    )

    return result


def print_table_3(results: list[dict]):
    """Print paper Table 3 format."""
    print("\n" + "="*80)
    print("TABLE 3 — Scalability (Sensor streams vs p99 latency)")
    print("="*80)
    print(f"{'Assets':>8} {'Streams':>10} {'Avg p99 (ms)':>14} {'Max p99 (ms)':>14} {'Kafka Lag':>12}")
    print("-"*80)
    for r in results:
        print(
            f"{r['assets']:>8} "
            f"{r['sensor_streams']:>10} "
            f"{str(r['p99_avg_ms']):>14} "
            f"{str(r['p99_max_ms']):>14} "
            f"{str(r['kafka_lag_avg']):>12}"
        )
    print("="*80)


def run():
    logger.info("Scale test starting")
    logger.info(f"State engine: {STATE_ENGINE_URL}")
    logger.info(f"Load levels:  {[l['assets'] for l in LOAD_LEVELS]}")

    # Health check
    try:
        h = requests.get(f"{STATE_ENGINE_URL}/health", timeout=10).json()
        logger.info(f"Health: {h}")
    except Exception as e:
        logger.error(f"State engine not reachable: {e}")
        return

    all_results = []

    for level in LOAD_LEVELS:
        r = run_load_level(level)
        all_results.append(r)
        time.sleep(30)  # brief cooldown between levels

    # Print Table 3
    print_table_3(all_results)

    # Save results
    output = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "state_engine_url": STATE_ENGINE_URL,
        "kafka_bootstrap": KAFKA_BOOTSTRAP,
        "results": all_results,
    }
    with open(RESULTS_FILE, "w") as f:
        json.dump(output, f, indent=2)
    logger.info(f"\nResults saved to {RESULTS_FILE}")


if __name__ == "__main__":
    run()
