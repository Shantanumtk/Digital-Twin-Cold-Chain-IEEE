"""
State Calculator - Computes asset state from telemetry using profile thresholds.
Reads thresholds from the active YAML profile instead of hardcoded values.
"""

from enum import Enum
from datetime import datetime, timezone
from typing import Optional

from profile_loader import get_thresholds


class AssetState(str, Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


class StateCalculator:
    """Calculate asset state based on telemetry and profile thresholds."""

    @classmethod
    def calculate_state(cls, telemetry: dict, previous_state: Optional[dict] = None) -> dict:
        """
        Calculate asset state from telemetry.

        Returns:
            dict with state, reasons, and metadata
        """
        asset_type = telemetry.get("asset_type", "unknown")
        asset_id = telemetry.get("truck_id") or telemetry.get("sensor_id")
        temperature = telemetry.get("temperature_c")
        door_open = telemetry.get("door_open", False)
        compressor_running = telemetry.get("compressor_running", True)

        # Get thresholds from active profile
        thresholds = get_thresholds(asset_type, asset_id)
        temp_warning = thresholds["temp_warning"]
        temp_critical = thresholds["temp_critical"]

        reasons = []
        state = AssetState.NORMAL

        # Temperature checks using profile thresholds
        if temperature is not None:
            if temperature > temp_critical:
                state = AssetState.CRITICAL
                reasons.append(
                    f"Temperature critical: {temperature:.1f}°C > {temp_critical}°C"
                )
            elif temperature > temp_warning:
                state = AssetState.WARNING
                reasons.append(
                    f"Temperature warning: {temperature:.1f}°C > {temp_warning}°C"
                )

        # Door open checks
        if door_open:
            if compressor_running:
                state = AssetState.CRITICAL
                reasons.append("Door open while compressor running - energy waste")
            else:
                if state != AssetState.CRITICAL:
                    state = AssetState.WARNING
                reasons.append("Door open")

        # Compressor check
        if not compressor_running and temperature is not None and temperature > temp_warning:
            state = AssetState.CRITICAL
            reasons.append("Compressor off with elevated temperature")

        return {
            "state": state.value,
            "reasons": reasons,
            "temperature_c": temperature,
            "door_open": door_open,
            "compressor_running": compressor_running,
            "threshold_type": thresholds["threshold_type"],
            "calculated_at": datetime.now(timezone.utc).isoformat(),
        }

    @classmethod
    def get_state_priority(cls, state: str) -> int:
        """Get priority for state (higher = worse)."""
        priorities = {
            AssetState.NORMAL.value: 0,
            AssetState.WARNING.value: 1,
            AssetState.CRITICAL.value: 2,
            AssetState.UNKNOWN.value: -1,
        }
        return priorities.get(state, -1)
