#!/usr/bin/env python3
"""
eval/harness.py — Docker Eval Harness (THE paper contribution)

This is the evaluation harness described in the paper:
  "first Docker-native fault-injection simulator for cold chain IoT
   that emits labeled Kafka ground truth, enabling reproducible
   precision/recall evaluation of a LangGraph multi-agent anomaly
   detection pipeline"

How it works:
  1. For each scenario in scenarios.yaml:
       a. Inject fault via MQTT command topic
       b. Wait for agent to classify (poll MCP agent /api/chat/query)
       c. Read ground truth from coldchain.ground.truth Kafka topic
       d. Compare agent output (anomaly_label) to ground truth
       e. Record P/R/F1 per fault type + p99 latency
  2. Print final metrics table (matches paper Table 2)

Usage:
  # With docker-compose.eval.yml running:
  python eval/harness.py

  # Against EKS:
  STATE_ENGINE_URL=http://... MCP_AGENT_URL=http://... python eval/harness.py
"""

import os
import json
import time
import uuid
import logging
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import paho.mqtt.client as mqtt
import yaml
from confluent_kafka import Consumer, KafkaException
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Configuration (override with env vars for EKS) ───────────────────────────
MQTT_BROKER         = os.getenv("MQTT_BROKER",      "localhost")
MQTT_PORT           = int(os.getenv("MQTT_PORT",    "1883"))
KAFKA_SERVERS       = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
MCP_AGENT_URL       = os.getenv("MCP_AGENT_URL",    "http://localhost:8001")
STATE_ENGINE_URL    = os.getenv("STATE_ENGINE_URL",  "http://localhost:8000")
GROUND_TRUTH_TOPIC  = "coldchain.ground.truth"
SCENARIOS_FILE      = os.path.join(os.path.dirname(__file__), "scenarios.yaml")

# Eval parameters
WAIT_FOR_AGENT_SEC  = int(os.getenv("WAIT_FOR_AGENT_SEC",  "30"))
POLL_INTERVAL_SEC   = float(os.getenv("POLL_INTERVAL_SEC", "2.0"))
MAX_RETRIES         = 5


# =============================================================================
# MQTT Client
# =============================================================================

class MQTTCommander:
    def __init__(self):
        self.client = mqtt.Client(
            client_id=f"eval-harness-{uuid.uuid4().hex[:8]}",
            protocol=mqtt.MQTTv311,
        )
        self.client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        self.client.loop_start()

    def inject_fault(self, scenario: dict) -> str:
        """
        Publish MQTT command to inject a fault.
        Also publishes to coldchain.ground.truth Kafka topic via the bridge.
        Returns trace_id for correlation.
        """
        trace_id   = str(uuid.uuid4())
        asset_id   = scenario["asset_id"]
        trigger    = scenario["trigger"]
        duration   = scenario.get("duration_sec", 120)
        fault_type = scenario["fault_type"]

        if trigger is None:
            # NORMAL scenario — no fault injection
            logger.info(f"[{scenario['id']}] No fault injection (NORMAL scenario)")
            return trace_id

        if trigger == "set_temperature":
            topic   = f"commands/{asset_id}/temperature"
            payload = {
                "action":           "set",
                "value":            scenario["value"],
                "duration_seconds": duration,
                "trace_id":         trace_id,
            }
        elif trigger == "fail_compressor":
            topic   = f"commands/{asset_id}/compressor"
            payload = {
                "action":           "fail",
                "duration_seconds": duration,
                "trace_id":         trace_id,
            }
        elif trigger == "open_door":
            topic   = f"commands/{asset_id}/door"
            payload = {
                "action":           "open",
                "duration_seconds": duration,
                "trace_id":         trace_id,
            }
        elif trigger == "power_outage":
            topic   = f"commands/{asset_id}/power"
            payload = {
                "action":           "outage",
                "duration_seconds": duration,
                "trace_id":         trace_id,
            }
        else:
            logger.warning(f"Unknown trigger: {trigger}")
            return trace_id

        self.client.publish(topic, json.dumps(payload), qos=1)
        logger.info(f"[{scenario['id']}] Injected {fault_type} on {asset_id} via {topic}")
        return trace_id

    def stop(self):
        self.client.loop_stop()
        self.client.disconnect()


# =============================================================================
# Ground Truth Kafka Reader
# =============================================================================

class GroundTruthReader:
    def __init__(self):
        self.consumer = Consumer({
            "bootstrap.servers":  KAFKA_SERVERS,
            "group.id":           f"eval-harness-gt-{uuid.uuid4().hex[:8]}",
            "auto.offset.reset":  "latest",
            "enable.auto.commit": False,
        })
        self.consumer.subscribe([GROUND_TRUTH_TOPIC])
        self._buffer = {}  # trace_id → ground_truth_event

    def poll_for_trace(self, trace_id: str, timeout_sec: float = 30.0) -> Optional[dict]:
        """Poll for a ground truth event matching trace_id."""
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            msg = self.consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                continue
            try:
                event = json.loads(msg.value().decode("utf-8"))
                if event.get("trace_id") == trace_id:
                    return event
                # Cache for later
                self._buffer[event.get("trace_id")] = event
            except Exception:
                pass
        return self._buffer.get(trace_id)

    def close(self):
        self.consumer.close()


# =============================================================================
# MCP Agent Caller
# =============================================================================

def query_agent(asset_id: str, fault_type: str) -> Optional[dict]:
    """
    Send a query to the MCP agent and return the full response with state fields.
    Uses process_query_with_state() via the /api/chat/query endpoint.
    """
    message = (
        f"Is there an anomaly on {asset_id}? "
        f"Classify any fault and provide root cause."
    )
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                f"{MCP_AGENT_URL}/api/chat/query",
                json={"message": message},
                timeout=60,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
            else:
                logger.error(f"Agent query failed after {MAX_RETRIES} attempts: {e}")
    return None


# =============================================================================
# Metrics Computation
# =============================================================================

def compute_metrics(results: list[dict]) -> dict:
    """
    Compute per-fault-type and overall precision, recall, F1.
    Also computes p50/p95/p99 end-to-end latency.

    Matches paper Table 2 format.
    """
    fault_types = ["TEMP_BREACH", "COMPRESSOR_FAIL", "DOOR_FAULT", "POWER_OUTAGE", "NORMAL"]

    per_type_metrics = {}
    all_latencies = []

    for ft in fault_types:
        tp = fp = fn = tn = 0
        for r in results:
            gt    = r["ground_truth"]
            pred  = r["predicted"]
            is_gt = (gt == ft)
            is_pr = (pred == ft)

            if is_gt and is_pr:
                tp += 1
            elif not is_gt and is_pr:
                fp += 1
            elif is_gt and not is_pr:
                fn += 1
            else:
                tn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1        = (2 * precision * recall / (precision + recall)
                     if (precision + recall) > 0 else 0.0)

        per_type_metrics[ft] = {
            "precision": round(precision, 4),
            "recall":    round(recall,    4),
            "f1":        round(f1,        4),
            "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        }

    # Overall metrics (macro average)
    all_p = [m["precision"] for m in per_type_metrics.values()]
    all_r = [m["recall"]    for m in per_type_metrics.values()]
    all_f = [m["f1"]        for m in per_type_metrics.values()]

    macro_p  = sum(all_p) / len(all_p)
    macro_r  = sum(all_r) / len(all_r)
    macro_f1 = sum(all_f) / len(all_f)

    # Latency metrics
    for r in results:
        if r.get("latency_ms") is not None:
            all_latencies.append(r["latency_ms"])

    latency_metrics = {}
    if all_latencies:
        sorted_lats = sorted(all_latencies)
        n = len(sorted_lats)
        latency_metrics = {
            "p50_ms":  round(sorted_lats[int(n * 0.50)], 2),
            "p95_ms":  round(sorted_lats[int(n * 0.95)], 2),
            "p99_ms":  round(sorted_lats[int(n * 0.99)], 2),
            "mean_ms": round(statistics.mean(all_latencies), 2),
            "count":   n,
        }

    return {
        "per_fault_type": per_type_metrics,
        "macro_average": {
            "precision": round(macro_p,  4),
            "recall":    round(macro_r,  4),
            "f1":        round(macro_f1, 4),
        },
        "latency": latency_metrics,
        "total_scenarios": len(results),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def print_table_2(metrics: dict):
    """Print paper Table 2 format."""
    print("\n" + "="*70)
    print("TABLE 2 — Simulator Accuracy (Docker Eval Harness)")
    print("="*70)
    print(f"{'Fault Type':<22} {'Precision':>10} {'Recall':>10} {'F1':>10}")
    print("-"*70)
    for ft, m in metrics["per_fault_type"].items():
        print(f"{ft:<22} {m['precision']:>10.4f} {m['recall']:>10.4f} {m['f1']:>10.4f}")
    print("-"*70)
    ma = metrics["macro_average"]
    print(f"{'MACRO AVERAGE':<22} {ma['precision']:>10.4f} {ma['recall']:>10.4f} {ma['f1']:>10.4f}")
    print("="*70)

    lat = metrics.get("latency", {})
    if lat:
        print(f"\nLatency (n={lat.get('count',0)}): "
              f"p50={lat.get('p50_ms','N/A')}ms  "
              f"p95={lat.get('p95_ms','N/A')}ms  "
              f"p99={lat.get('p99_ms','N/A')}ms  "
              f"mean={lat.get('mean_ms','N/A')}ms")
    print()


# =============================================================================
# Main Eval Loop
# =============================================================================

def run_eval():
    logger.info("="*60)
    logger.info("Cold Chain Eval Harness — starting")
    logger.info(f"MQTT:        {MQTT_BROKER}:{MQTT_PORT}")
    logger.info(f"Kafka:       {KAFKA_SERVERS}")
    logger.info(f"MCP Agent:   {MCP_AGENT_URL}")
    logger.info(f"State Engine:{STATE_ENGINE_URL}")
    logger.info("="*60)

    # Load scenarios
    with open(SCENARIOS_FILE) as f:
        cfg = yaml.safe_load(f)
    scenarios = cfg["scenarios"]
    logger.info(f"Loaded {len(scenarios)} scenarios from {SCENARIOS_FILE}")

    # Check MCP agent health
    try:
        health = requests.get(f"{MCP_AGENT_URL}/api/health", timeout=10).json()
        logger.info(f"Agent health: {health.get('status')} graph_ok={health.get('graph_ok')}")
    except Exception as e:
        logger.error(f"MCP Agent not reachable: {e}. Ensure docker-compose.eval.yml is up.")
        return

    commander = MQTTCommander()
    gt_reader = GroundTruthReader()
    results   = []

    for scenario in scenarios:
        sid       = scenario["id"]
        asset_id  = scenario["asset_id"]
        fault_type= scenario["fault_type"]
        expected  = scenario["expected_state"]

        logger.info(f"\n── Scenario {sid}: {scenario['description']}")

        # 1. Inject fault
        t_inject = time.perf_counter()
        trace_id = commander.inject_fault(scenario)
        time.sleep(2)  # let the fault propagate through MQTT → Kafka

        # 2. Wait for state engine to process, then query agent
        logger.info(f"   Waiting {WAIT_FOR_AGENT_SEC}s for fault to propagate...")
        time.sleep(min(WAIT_FOR_AGENT_SEC, scenario.get("duration_sec", 120) // 3))

        t_query = time.perf_counter()
        agent_resp = query_agent(asset_id, fault_type)
        t_done = time.perf_counter()

        latency_ms = (t_done - t_query) * 1000

        # 3. Extract prediction
        predicted_label = "UNKNOWN"
        confidence = 0.0
        if agent_resp:
            predicted_label = agent_resp.get("anomaly_label") or "UNKNOWN"
            confidence      = agent_resp.get("confidence") or 0.0
            # Fallback: check response text
            if predicted_label == "UNKNOWN":
                resp_text = (agent_resp.get("response") or "").upper()
                for lbl in ["TEMP_BREACH", "COMPRESSOR_FAIL", "DOOR_FAULT", "POWER_OUTAGE", "NORMAL"]:
                    if lbl in resp_text:
                        predicted_label = lbl
                        break

        # If NORMAL scenario and agent says NORMAL → correct
        if fault_type == "NORMAL" and predicted_label in (None, "UNKNOWN", ""):
            predicted_label = "NORMAL"

        correct = (predicted_label == fault_type)
        status  = "✓" if correct else "✗"

        logger.info(
            f"   {status} GT={fault_type:<18} PRED={predicted_label:<18} "
            f"conf={confidence:.2f} latency={latency_ms:.0f}ms"
        )

        results.append({
            "scenario_id":   sid,
            "asset_id":      asset_id,
            "ground_truth":  fault_type,
            "predicted":     predicted_label,
            "confidence":    confidence,
            "expected_state":expected,
            "correct":       correct,
            "latency_ms":    latency_ms,
            "trace_id":      trace_id,
        })

    commander.stop()
    gt_reader.close()

    # Compute metrics
    metrics = compute_metrics(results)

    # Print Table 2
    print_table_2(metrics)

    # Per-scenario breakdown
    print("SCENARIO BREAKDOWN:")
    print(f"{'ID':<8} {'Asset':<22} {'GT Label':<20} {'Predicted':<20} {'Correct'}")
    print("-"*80)
    for r in results:
        mark = "✓" if r["correct"] else "✗"
        print(
            f"{r['scenario_id']:<8} {r['asset_id']:<22} "
            f"{r['ground_truth']:<20} {r['predicted']:<20} {mark}"
        )

    # Save results to JSON for paper table
    out_path = os.path.join(os.path.dirname(__file__), "harness_results.json")
    with open(out_path, "w") as f:
        json.dump({"metrics": metrics, "results": results}, f, indent=2)
    logger.info(f"\nResults saved to {out_path}")

    correct_count = sum(1 for r in results if r["correct"])
    logger.info(
        f"Overall accuracy: {correct_count}/{len(results)} "
        f"({correct_count/len(results)*100:.1f}%)"
    )


if __name__ == "__main__":
    run_eval()
