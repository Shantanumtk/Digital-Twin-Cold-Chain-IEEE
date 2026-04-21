#!/usr/bin/env python3
"""
eval/baseline_eval.py — Threshold-only baseline (no LLM, no agent).

This is the "Method: Threshold Baseline" row in paper Table 1.
It provides the P/R/F1 comparison point that the LangGraph agent must beat.

Algorithm:
  - If temperature_c > TEMP_CRITICAL → predict CRITICAL (anomaly=1)
  - If temperature_c > TEMP_WARNING  → predict WARNING  (anomaly=1)
  - Else                             → predict NORMAL   (anomaly=0)

Matches exactly the logic in state-engine/state_calculator.py,
confirming that the agent adds value BEYOND simple thresholding.

Usage:
  # Preprocess first:
  python eval/preprocess_plosone.py

  # Then run baseline:
  python eval/baseline_eval.py
"""

import os
import json
import logging
from pathlib import Path

import pandas as pd
from sklearn.metrics import (
    precision_score, recall_score, f1_score,
    classification_report, confusion_matrix,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DATASET_FILE  = Path(__file__).parent / "datasets" / "plosone" / "processed.csv"
RESULTS_FILE  = Path(__file__).parent / "baseline_results.json"

# Must match preprocess_plosone.py thresholds
TEMP_CRITICAL = -10.0
TEMP_WARNING  = -15.0


def threshold_predict(temperature_c: float) -> int:
    """Returns 1 (anomaly) or 0 (normal) based on threshold rules alone."""
    if pd.isna(temperature_c):
        return 0
    if temperature_c > TEMP_WARNING:
        return 1
    return 0


def run():
    if not DATASET_FILE.exists():
        logger.error(
            f"Processed dataset not found at {DATASET_FILE}. "
            "Run `python eval/preprocess_plosone.py` first."
        )
        return

    df = pd.read_csv(DATASET_FILE)
    logger.info(f"Loaded {len(df):,} rows from {DATASET_FILE}")

    # Apply threshold prediction
    df["predicted_binary"] = df["temperature_c"].apply(threshold_predict)
    y_true = df["anomaly_binary"].values
    y_pred = df["predicted_binary"].values

    # Compute metrics
    precision = precision_score(y_true, y_pred, zero_division=0)
    recall    = recall_score(y_true,    y_pred, zero_division=0)
    f1        = f1_score(y_true,        y_pred, zero_division=0)

    # Per-vehicle breakdown
    vehicle_metrics = {}
    for vid, grp in df.groupby("vehicle_id"):
        vp = precision_score(grp["anomaly_binary"], grp["predicted_binary"], zero_division=0)
        vr = recall_score(grp["anomaly_binary"],    grp["predicted_binary"], zero_division=0)
        vf = f1_score(grp["anomaly_binary"],         grp["predicted_binary"], zero_division=0)
        vehicle_metrics[vid] = {
            "precision": round(float(vp), 4),
            "recall":    round(float(vr), 4),
            "f1":        round(float(vf), 4),
            "n_samples": int(len(grp)),
        }

    # Confusion matrix
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()

    # Print Table 1 row
    print("\n" + "="*60)
    print("TABLE 1 ROW — Threshold Baseline (CCL-2023 Dataset)")
    print("="*60)
    print(f"Method    : Threshold-Only (no LLM)")
    print(f"Dataset   : PLOS One CCL-2023")
    print(f"Samples   : {len(df):,}")
    print(f"Precision : {precision:.4f}")
    print(f"Recall    : {recall:.4f}")
    print(f"F1        : {f1:.4f}")
    print(f"TP={tp}  FP={fp}  TN={tn}  FN={fn}")
    print()
    print("Per-vehicle breakdown:")
    for vid, m in vehicle_metrics.items():
        print(f"  {vid}: P={m['precision']:.4f} R={m['recall']:.4f} F1={m['f1']:.4f} (n={m['n_samples']:,})")
    print("="*60)
    print()
    print("Full classification report:")
    print(classification_report(y_true, y_pred, target_names=["NORMAL", "ANOMALY"]))

    # Save results
    results = {
        "method":       "threshold_baseline",
        "dataset":      "plosone_ccl_2023",
        "precision":    round(float(precision), 4),
        "recall":       round(float(recall),    4),
        "f1":           round(float(f1),        4),
        "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
        "n_samples":    int(len(df)),
        "thresholds": {
            "temp_critical_c": TEMP_CRITICAL,
            "temp_warning_c":  TEMP_WARNING,
        },
        "per_vehicle":  vehicle_metrics,
    }

    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)
    logger.info(f"Results saved to {RESULTS_FILE}")


if __name__ == "__main__":
    run()
