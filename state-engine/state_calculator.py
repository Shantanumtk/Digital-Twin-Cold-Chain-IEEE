"""
State Calculator - Computes asset state from telemetry
"""

from enum import Enum
from datetime import datetime, timezone
from typing import Optional


class AssetState(str, Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


class StateCalculator:
    """Calculate asset state based on telemetry and thresholds"""
    
    # Temperature thresholds (Celsius)
    TRUCK_TEMP_NORMAL_MAX = -15.0
    TRUCK_TEMP_WARNING_MAX = -10.0
    TRUCK_TEMP_CRITICAL_MAX = -5.0
    
    ROOM_TEMP_NORMAL_MAX = -18.0
    ROOM_TEMP_WARNING_MAX = -15.0
    ROOM_TEMP_CRITICAL_MAX = -10.0
    
    # Door open thresholds (seconds)
    DOOR_OPEN_WARNING_SECONDS = 60
    DOOR_OPEN_CRITICAL_SECONDS = 180
    
    @classmethod
    def calculate_state(cls, telemetry: dict, previous_state: Optional[dict] = None) -> dict:
        """
        Calculate asset state from telemetry
        
        Returns:
            dict with state, reasons, and metadata
        """
        asset_type = telemetry.get("asset_type", "unknown")
        temperature = telemetry.get("temperature_c")
        door_open = telemetry.get("door_open", False)
        compressor_running = telemetry.get("compressor_running", True)
        
        reasons = []
        state = AssetState.NORMAL
        
        # Temperature checks
        if temperature is not None:
            if asset_type == "refrigerated_truck":
                if temperature > cls.TRUCK_TEMP_CRITICAL_MAX:
                    state = AssetState.CRITICAL
                    reasons.append(f"Temperature critical: {temperature:.1f}°C > {cls.TRUCK_TEMP_CRITICAL_MAX}°C")
                elif temperature > cls.TRUCK_TEMP_WARNING_MAX:
                    state = AssetState.WARNING
                    reasons.append(f"Temperature warning: {temperature:.1f}°C > {cls.TRUCK_TEMP_WARNING_MAX}°C")
                elif temperature > cls.TRUCK_TEMP_NORMAL_MAX:
                    if state != AssetState.CRITICAL:
                        state = AssetState.WARNING
                    reasons.append(f"Temperature elevated: {temperature:.1f}°C")
            else:  # cold_room
                if temperature > cls.ROOM_TEMP_CRITICAL_MAX:
                    state = AssetState.CRITICAL
                    reasons.append(f"Temperature critical: {temperature:.1f}°C > {cls.ROOM_TEMP_CRITICAL_MAX}°C")
                elif temperature > cls.ROOM_TEMP_WARNING_MAX:
                    state = AssetState.WARNING
                    reasons.append(f"Temperature warning: {temperature:.1f}°C > {cls.ROOM_TEMP_WARNING_MAX}°C")
                elif temperature > cls.ROOM_TEMP_NORMAL_MAX:
                    if state != AssetState.CRITICAL:
                        state = AssetState.WARNING
                    reasons.append(f"Temperature elevated: {temperature:.1f}°C")
        
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
        if not compressor_running and temperature and temperature > cls.TRUCK_TEMP_WARNING_MAX:
            state = AssetState.CRITICAL
            reasons.append("Compressor off with elevated temperature")
        
        return {
            "state": state.value,
            "reasons": reasons,
            "temperature_c": temperature,
            "door_open": door_open,
            "compressor_running": compressor_running,
            "calculated_at": datetime.now(timezone.utc).isoformat()
        }
    
    @classmethod
    def get_state_priority(cls, state: str) -> int:
        """Get priority for state (higher = worse)"""
        priorities = {
            AssetState.NORMAL.value: 0,
            AssetState.WARNING.value: 1,
            AssetState.CRITICAL.value: 2,
            AssetState.UNKNOWN.value: -1
        }
        return priorities.get(state, -1)