#!/usr/bin/env python3
"""
eval/preprocess_plosone.py — Preprocess PLOS One CCL-2023 dataset.

Dataset: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0315322
  - Real cold chain vehicle sensors, Dec 2023, Ningbo China
  - 3 vehicles (S1.csv, S2.csv, S3.csv)
  - Columns: timestamp, temperature, humidity, CO2, O2, pressure
  - License: CC BY — free to use, cite the paper

This script:
  1. Loads S1.csv, S2.csv, S3.csv from eval/datasets/plosone/
  2. Derives binary anomaly labels from threshold rules:
       - anomaly=1 if temperature > -18°C (frozen goods threshold)
       - anomaly=0 otherwise
  3. Normalizes column names to match state engine schema
  4. Saves to eval/datasets/plosone/processed.csv for use by dataset_eval.py

Citation:
  [Paper citation to be added when DOI confirmed]
"""

import os
import sys
import logging
from pathlib import Path

import pandas as pd
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
DATASET_DIR   = Path(__file__).parent / "datasets" / "plosone"
OUTPUT_FILE   = DATASET_DIR / "processed.csv"

# ── Thresholds from the frozen-logistics.yaml profile ────────────────────────
TEMP_CRITICAL = -10.0   # °C — CRITICAL above this
TEMP_WARNING  = -15.0   # °C — WARNING above this (but below critical)
# Derived from paper: cold chain vehicles carry frozen goods, setpoint -18°C

# ── Column name mapping (CCL-2023 → state engine schema) ────────────────────
COLUMN_MAP = {
    "Time":        "timestamp",
    "Temp":        "temperature_c",
    "Humidity":    "humidity_pct",
    "CO2":         "co2_ppm",
    "O2":          "o2_pct",
    "Pressure":    "pressure_pa",
    # Alternative naming styles in the dataset
    "temperature": "temperature_c",
    "humidity":    "humidity_pct",
    "time":        "timestamp",
    "TEMP":        "temperature_c",
    "HUMIDITY":    "humidity_pct",
    "TIME":        "timestamp",
}


def derive_anomaly_label(row: pd.Series) -> str:
    """
    Derive NORMAL / WARNING / CRITICAL label from temperature.
    Mirrors the logic in state-engine/state_calculator.py (frozen_goods profile).
    """
    temp = row["temperature_c"]
    if pd.isna(temp):
        return "UNKNOWN"
    if temp > TEMP_CRITICAL:
        return "CRITICAL"
    elif temp > TEMP_WARNING:
        return "WARNING"
    else:
        return "NORMAL"


def derive_anomaly_binary(row: pd.Series) -> int:
    """Binary anomaly flag: 1 = anomalous (WARNING or CRITICAL), 0 = NORMAL."""
    label = derive_anomaly_label(row)
    return 0 if label == "NORMAL" else 1


def load_vehicle_csv(path: Path, vehicle_id: str) -> pd.DataFrame:
    """Load one vehicle CSV, normalize columns, add metadata."""
    logger.info(f"Loading {path.name} → vehicle {vehicle_id}")

    df = pd.read_csv(path)
    logger.info(f"  Raw shape: {df.shape}, columns: {list(df.columns)}")

    # Normalize column names
    df = df.rename(columns={c: COLUMN_MAP.get(c, c.lower()) for c in df.columns})

    # Ensure required columns exist
    if "temperature_c" not in df.columns:
        # Try to find any temperature-like column
        temp_cols = [c for c in df.columns if "temp" in c.lower()]
        if temp_cols:
            df = df.rename(columns={temp_cols[0]: "temperature_c"})
            logger.warning(f"  Inferred temperature column: {temp_cols[0]}")
        else:
            raise ValueError(f"Cannot find temperature column in {path.name}. Available: {list(df.columns)}")

    if "timestamp" not in df.columns:
        time_cols = [c for c in df.columns if "time" in c.lower() or "date" in c.lower()]
        if time_cols:
            df = df.rename(columns={time_cols[0]: "timestamp"})
        else:
            # Create synthetic timestamps
            df["timestamp"] = pd.date_range("2023-12-01", periods=len(df), freq="5s")

    if "humidity_pct" not in df.columns:
        hum_cols = [c for c in df.columns if "hum" in c.lower()]
        if hum_cols:
            df = df.rename(columns={hum_cols[0]: "humidity_pct"})
        else:
            df["humidity_pct"] = 50.0  # Default if not available

    # Parse timestamps
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"])

    # Coerce temperature to float
    df["temperature_c"] = pd.to_numeric(df["temperature_c"], errors="coerce")
    df = df.dropna(subset=["temperature_c"])

    # Add metadata
    df["vehicle_id"]     = vehicle_id
    df["asset_type"]     = "refrigerated_truck"
    df["door_open"]      = False   # Not measured in CCL-2023
    df["compressor_running"] = True  # Assume compressor running (conservative)

    # Derive labels
    df["anomaly_label"]  = df.apply(derive_anomaly_label, axis=1)
    df["anomaly_binary"] = df.apply(derive_anomaly_binary, axis=1)

    df = df.sort_values("timestamp").reset_index(drop=True)

    n_anomaly = df["anomaly_binary"].sum()
    logger.info(
        f"  Processed: {len(df)} rows, "
        f"{n_anomaly} anomalous ({n_anomaly/len(df)*100:.1f}%), "
        f"temp range: {df['temperature_c'].min():.1f}–{df['temperature_c'].max():.1f}°C"
    )

    return df


def run():
    DATASET_DIR.mkdir(parents=True, exist_ok=True)

    # Find available files
    csv_files = {
        "truck-s1": DATASET_DIR / "S1.csv",
        "truck-s2": DATASET_DIR / "S2.csv",
        "truck-s3": DATASET_DIR / "S3.csv",
    }

    available = {vid: path for vid, path in csv_files.items() if path.exists()}
    if not available:
        logger.error(
            f"No dataset files found in {DATASET_DIR}. "
            "Download S1.csv, S2.csv, S3.csv from "
            "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0315322 "
            "(Supporting Information section) and place them in eval/datasets/plosone/"
        )
        sys.exit(1)

    logger.info(f"Found {len(available)} vehicle files: {list(available.keys())}")

    # Load and concatenate
    dfs = []
    for vehicle_id, path in available.items():
        try:
            df = load_vehicle_csv(path, vehicle_id)
            dfs.append(df)
        except Exception as e:
            logger.error(f"Failed to load {path.name}: {e}")

    if not dfs:
        logger.error("No files loaded successfully.")
        sys.exit(1)

    combined = pd.concat(dfs, ignore_index=True)
    combined = combined.sort_values(["vehicle_id", "timestamp"]).reset_index(drop=True)

    # Summary statistics
    logger.info("\n── Dataset Summary ──")
    logger.info(f"Total rows:      {len(combined):,}")
    logger.info(f"Total anomalous: {combined['anomaly_binary'].sum():,} "
                f"({combined['anomaly_binary'].mean()*100:.1f}%)")
    logger.info(f"Per vehicle:")
    for vid, grp in combined.groupby("vehicle_id"):
        n_anom = grp["anomaly_binary"].sum()
        logger.info(
            f"  {vid}: {len(grp):,} rows, "
            f"{n_anom:,} anomalous ({n_anom/len(grp)*100:.1f}%), "
            f"temp [{grp['temperature_c'].min():.1f}, {grp['temperature_c'].max():.1f}]°C"
        )
    logger.info(f"\nThresholds used:")
    logger.info(f"  CRITICAL: temperature_c > {TEMP_CRITICAL}°C")
    logger.info(f"  WARNING:  temperature_c > {TEMP_WARNING}°C")
    logger.info(f"  NORMAL:   temperature_c <= {TEMP_WARNING}°C")

    # Save processed file
    combined.to_csv(OUTPUT_FILE, index=False)
    logger.info(f"\nSaved processed dataset to {OUTPUT_FILE}")

    # Also save a stats JSON for the paper
    stats_path = DATASET_DIR / "dataset_stats.json"
    import json
    stats = {
        "total_rows":       int(len(combined)),
        "total_anomalous":  int(combined["anomaly_binary"].sum()),
        "anomaly_rate":     float(combined["anomaly_binary"].mean()),
        "vehicles":         int(combined["vehicle_id"].nunique()),
        "temp_min":         float(combined["temperature_c"].min()),
        "temp_max":         float(combined["temperature_c"].max()),
        "temp_mean":        float(combined["temperature_c"].mean()),
        "thresholds": {
            "temp_critical_c": TEMP_CRITICAL,
            "temp_warning_c":  TEMP_WARNING,
        },
        "label_distribution": combined["anomaly_label"].value_counts().to_dict(),
    }
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)
    logger.info(f"Stats saved to {stats_path}")


if __name__ == "__main__":
    run()
