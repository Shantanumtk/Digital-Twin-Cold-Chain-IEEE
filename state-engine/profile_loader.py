"""
Profile Loader — Reads threshold configuration from YAML profile.
Mounted at /app/config/active.yaml in the container.
Falls back to hardcoded defaults if file not found.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

PROFILE_PATH = os.getenv("PROFILE_PATH", "/app/config/active.yaml")

_profile = None


def _load_yaml():
    """Load YAML without requiring pyyaml at import time."""
    try:
        import yaml
        return yaml
    except ImportError:
        logger.warning("pyyaml not installed, using defaults")
        return None


def load_profile() -> dict:
    """Load the active profile from YAML file."""
    global _profile
    if _profile is not None:
        return _profile

    yaml_mod = _load_yaml()
    if yaml_mod is None:
        _profile = _default_profile()
        return _profile

    if not os.path.exists(PROFILE_PATH):
        logger.warning(f"Profile not found at {PROFILE_PATH}, using defaults")
        _profile = _default_profile()
        return _profile

    try:
        with open(PROFILE_PATH) as f:
            _profile = yaml_mod.safe_load(f)
        logger.info(f"Loaded profile: {_profile.get('name', 'unknown')}")
        return _profile
    except Exception as e:
        logger.error(f"Failed to load profile: {e}")
        _profile = _default_profile()
        return _profile


def reload_profile():
    """Force reload the profile from disk."""
    global _profile
    _profile = None
    return load_profile()


def get_thresholds(asset_type: str, asset_id: Optional[str] = None) -> dict:
    """Get temperature thresholds for an asset.

    Lookup order:
    1. asset_assignments (specific asset override)
    2. asset_defaults (by asset type)
    3. frozen_goods (fallback)

    Returns dict with temp_warning, temp_critical, humidity_min, humidity_max.
    """
    profile = load_profile()
    thresholds = profile.get("thresholds", {})
    assignments = profile.get("asset_assignments", {}) or {}
    defaults = profile.get("asset_defaults", {})

    # Determine which threshold type to use
    threshold_type = None

    # Check specific asset assignment first
    if asset_id and asset_id in assignments:
        threshold_type = assignments[asset_id]

    # Fall back to asset type default
    if not threshold_type:
        threshold_type = defaults.get(asset_type, "frozen_goods")

    # Get the actual threshold values
    threshold_values = thresholds.get(threshold_type, thresholds.get("frozen_goods", {}))

    return {
        "threshold_type": threshold_type,
        "temp_warning": threshold_values.get("temp_warning", -10.0),
        "temp_critical": threshold_values.get("temp_critical", -5.0),
        "humidity_min": threshold_values.get("humidity_min", 40),
        "humidity_max": threshold_values.get("humidity_max", 60),
    }


def get_fleet_config() -> dict:
    """Get fleet size configuration."""
    profile = load_profile()
    fleet = profile.get("fleet", {})
    return {
        "trucks": fleet.get("trucks", 5),
        "cold_rooms": fleet.get("cold_rooms", 5),
    }


def get_simulator_config() -> dict:
    """Get simulator configuration."""
    profile = load_profile()
    sim = profile.get("simulator", {})
    return {
        "publish_interval": sim.get("publish_interval", 5.0),
        "mqtt_qos": sim.get("mqtt_qos", 1),
    }


def get_profile_summary() -> dict:
    """Get a summary of the active profile."""
    profile = load_profile()
    return {
        "name": profile.get("name", "unknown"),
        "description": profile.get("description", ""),
        "fleet": profile.get("fleet", {}),
        "threshold_types": list(profile.get("thresholds", {}).keys()),
        "asset_assignments": profile.get("asset_assignments", {}),
        "asset_defaults": profile.get("asset_defaults", {}),
    }


def _default_profile() -> dict:
    """Hardcoded default profile as fallback."""
    return {
        "name": "default-fallback",
        "description": "Hardcoded fallback when no YAML profile is available",
        "fleet": {"trucks": 5, "cold_rooms": 5},
        "thresholds": {
            "frozen_goods": {
                "temp_warning": -10.0,
                "temp_critical": -5.0,
                "humidity_min": 40,
                "humidity_max": 60,
            },
            "chilled_goods": {
                "temp_warning": 4.0,
                "temp_critical": 8.0,
                "humidity_min": 50,
                "humidity_max": 70,
            },
            "pharma": {
                "temp_warning": 2.0,
                "temp_critical": 5.0,
                "humidity_min": 45,
                "humidity_max": 65,
            },
        },
        "asset_defaults": {
            "refrigerated_truck": "frozen_goods",
            "cold_room": "chilled_goods",
        },
        "asset_assignments": {},
        "simulator": {"publish_interval": 5.0, "mqtt_qos": 1},
    }
