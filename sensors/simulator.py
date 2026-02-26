"""
Cold Chain Digital Twin - Edge Layer Sensor Simulator
Simulates 20+ IoT sensors for cold rooms and refrigerated trucks
Publishing telemetry via MQTT (QoS 1/2, JSON payloads)

Supports command handling via MQTT topics:
  commands/{asset_id}/door        — open/close door
  commands/{asset_id}/compressor  — fail/restore compressor
  commands/{site_id}/power        — power outage/restore
"""

import json
import time
import random
import threading
import os
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional
import paho.mqtt.client as mqtt


# Configuration from environment
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_QOS = int(os.getenv("MQTT_QOS", 1))
PUBLISH_INTERVAL = float(os.getenv("PUBLISH_INTERVAL", 5.0))


@dataclass
class ColdRoomTelemetry:
    """Telemetry payload for cold room sensors"""
    sensor_id: str
    site_id: str
    room_id: str
    asset_type: str
    timestamp: str
    temperature_c: float
    humidity_pct: float
    door_open: bool
    compressor_running: bool
    compressor_cycle_count: int
    power_status: str


@dataclass
class TruckTelemetry:
    """Telemetry payload for refrigerated truck sensors"""
    sensor_id: str
    truck_id: str
    fleet_id: str
    asset_type: str
    timestamp: str
    temperature_c: float
    humidity_pct: float
    door_open: bool
    compressor_running: bool
    latitude: float
    longitude: float
    speed_kmh: float
    engine_running: bool


class ColdRoomSensor:
    """Simulates a cold room with realistic thermal dynamics"""

    def __init__(self, site_id: str, room_id: str, target_temp: float = -20.0):
        self.sensor_id = f"sensor-room-{site_id}-{room_id}"
        self.site_id = site_id
        self.room_id = room_id
        self.target_temp = target_temp
        self.current_temp = target_temp + random.uniform(-0.5, 0.5)
        self.humidity = random.uniform(45, 55)
        self.door_open = False
        self.compressor_running = True
        self.compressor_cycles = 0
        self.power_status = "normal"
        self.door_open_since: Optional[float] = None

        # Command overrides (set by MQTT commands, cleared by timers)
        self._cmd_door_open: Optional[bool] = None
        self._cmd_compressor_off: Optional[bool] = None
        self._cmd_power_outage: Optional[bool] = None

        # Thermal dynamics parameters
        self.cooling_rate = 0.3
        self.warming_rate = 0.1
        self.door_warming_rate = 0.8

    def simulate_step(self):
        """Advance simulation by one time step"""

        # Apply command overrides
        if self._cmd_door_open is not None:
            self.door_open = self._cmd_door_open
        if self._cmd_compressor_off is not None:
            self.compressor_running = not self._cmd_compressor_off
        if self._cmd_power_outage is not None:
            if self._cmd_power_outage:
                self.compressor_running = False
                self.power_status = "outage"

        # Only simulate random events if no command override is active
        if self._cmd_door_open is None:
            self._simulate_door_events()
        if self._cmd_compressor_off is None and self._cmd_power_outage is None:
            self._simulate_compressor_events()
        if self._cmd_power_outage is None:
            self._simulate_power_events()

        # Thermal dynamics
        if self.door_open:
            self.current_temp += random.uniform(0.3, self.door_warming_rate)
            self.humidity += random.uniform(1, 3)
        elif self.compressor_running:
            if self.current_temp > self.target_temp:
                self.current_temp -= random.uniform(0.1, self.cooling_rate)
        else:
            self.current_temp += random.uniform(0.05, self.warming_rate)

        if self.compressor_running and not self.door_open:
            self.humidity = max(40, self.humidity - random.uniform(0, 0.5))

        self.humidity = max(30, min(95, self.humidity))

        temp_noise = random.gauss(0, 0.1)
        humidity_noise = random.gauss(0, 0.5)

        return ColdRoomTelemetry(
            sensor_id=self.sensor_id,
            site_id=self.site_id,
            room_id=self.room_id,
            asset_type="cold_room",
            timestamp=datetime.now(timezone.utc).isoformat(),
            temperature_c=round(self.current_temp + temp_noise, 2),
            humidity_pct=round(self.humidity + humidity_noise, 1),
            door_open=self.door_open,
            compressor_running=self.compressor_running,
            compressor_cycle_count=self.compressor_cycles,
            power_status=self.power_status
        )

    def _simulate_door_events(self):
        if self.door_open:
            if self.door_open_since:
                open_duration = time.time() - self.door_open_since
                if open_duration > random.uniform(30, 120):
                    self.door_open = False
                    self.door_open_since = None
        else:
            if random.random() < 0.02:
                self.door_open = True
                self.door_open_since = time.time()

    def _simulate_compressor_events(self):
        if self.compressor_running:
            if self.current_temp < self.target_temp - 2:
                if random.random() < 0.1:
                    self.compressor_running = False
        else:
            if self.current_temp > self.target_temp + 1:
                self.compressor_running = True
                self.compressor_cycles += 1

    def _simulate_power_events(self):
        if self.power_status == "normal":
            if random.random() < 0.005:
                self.power_status = random.choice(["brownout", "backup"])
        else:
            if random.random() < 0.2:
                self.power_status = "normal"

    @property
    def mqtt_topic(self) -> str:
        return f"warehouse/{self.site_id}/room/{self.room_id}/telemetry"


class TruckSensor:
    """Simulates a refrigerated truck with GPS and thermal dynamics"""

    ROUTES = {
        "route_la_sf": [
            (34.0522, -118.2437), (34.4208, -119.6982),
            (35.2828, -120.6596), (36.7783, -119.4179),
            (37.3382, -121.8863), (37.7749, -122.4194),
        ],
        "route_sd_la": [
            (32.7157, -117.1611), (33.1959, -117.3795),
            (33.4484, -117.6323), (33.6846, -117.8265),
            (33.8366, -117.9143), (34.0522, -118.2437),
        ],
        "route_fullerton_local": [
            (33.8704, -117.9242), (33.8353, -117.9145),
            (33.7879, -117.8531), (33.7175, -117.8311),
            (33.8704, -117.9242),
        ]
    }

    def __init__(self, truck_id: str, fleet_id: str = "fleet1",
                 target_temp: float = -18.0, route_name: str = None):
        self.sensor_id = f"sensor-truck-{truck_id}"
        self.truck_id = truck_id
        self.fleet_id = fleet_id
        self.target_temp = target_temp
        self.current_temp = target_temp + random.uniform(-0.5, 0.5)
        self.humidity = random.uniform(40, 50)
        self.door_open = False
        self.compressor_running = True
        self.engine_running = True

        # Command overrides
        self._cmd_door_open: Optional[bool] = None
        self._cmd_compressor_off: Optional[bool] = None

        # GPS simulation
        self.route_name = route_name or random.choice(list(self.ROUTES.keys()))
        self.route = self.ROUTES[self.route_name]
        self.route_index = 0
        self.route_progress = 0.0
        self.speed = random.uniform(60, 90)

        self.latitude, self.longitude = self.route[0]

        self.cooling_rate = 0.25
        self.warming_rate = 0.15
        self.door_warming_rate = 1.0
        self.door_open_since: Optional[float] = None

    def simulate_step(self):
        """Advance simulation by one time step"""

        # Apply command overrides
        if self._cmd_door_open is not None:
            self.door_open = self._cmd_door_open
        if self._cmd_compressor_off is not None:
            self.compressor_running = not self._cmd_compressor_off

        self._simulate_movement()

        if self._cmd_door_open is None:
            self._simulate_door_events()

        self._simulate_thermal_dynamics()

        temp_noise = random.gauss(0, 0.15)
        humidity_noise = random.gauss(0, 0.8)

        return TruckTelemetry(
            sensor_id=self.sensor_id,
            truck_id=self.truck_id,
            fleet_id=self.fleet_id,
            asset_type="refrigerated_truck",
            timestamp=datetime.now(timezone.utc).isoformat(),
            temperature_c=round(self.current_temp + temp_noise, 2),
            humidity_pct=round(self.humidity + humidity_noise, 1),
            door_open=self.door_open,
            compressor_running=self.compressor_running,
            latitude=round(self.latitude, 6),
            longitude=round(self.longitude, 6),
            speed_kmh=round(self.speed, 1) if self.engine_running else 0,
            engine_running=self.engine_running
        )

    def _simulate_movement(self):
        if not self.engine_running:
            self.speed = 0
            return

        self.route_progress += random.uniform(0.01, 0.03)

        if self.route_progress >= 1.0:
            self.route_index = (self.route_index + 1) % len(self.route)
            self.route_progress = 0.0

            if random.random() < 0.3:
                self.engine_running = False
                if self._cmd_door_open is None:
                    self.door_open = True
                    self.door_open_since = time.time()

        current_wp = self.route[self.route_index]
        next_wp = self.route[(self.route_index + 1) % len(self.route)]

        self.latitude = current_wp[0] + (next_wp[0] - current_wp[0]) * self.route_progress
        self.longitude = current_wp[1] + (next_wp[1] - current_wp[1]) * self.route_progress

        self.speed = max(0, min(120, self.speed + random.uniform(-5, 5)))

    def _simulate_door_events(self):
        if self.door_open and self.door_open_since:
            open_duration = time.time() - self.door_open_since
            if open_duration > random.uniform(60, 300):
                self.door_open = False
                self.door_open_since = None
                self.engine_running = True
                self.speed = random.uniform(30, 50)

    def _simulate_thermal_dynamics(self):
        if self.door_open:
            self.current_temp += random.uniform(0.5, self.door_warming_rate)
            self.humidity += random.uniform(2, 5)
        elif not self.compressor_running or not self.engine_running:
            self.current_temp += random.uniform(0.05, self.warming_rate)
        else:
            if self.current_temp > self.target_temp:
                self.current_temp -= random.uniform(0.1, self.cooling_rate)

        if self.engine_running and self._cmd_compressor_off is None:
            if self.current_temp > self.target_temp + 2:
                self.compressor_running = True
            elif self.current_temp < self.target_temp - 1:
                self.compressor_running = random.random() > 0.3

        self.humidity = max(30, min(95, self.humidity))

    @property
    def mqtt_topic(self) -> str:
        return f"fleet/{self.truck_id}/telemetry"


class SensorFleetSimulator:
    """Manages a fleet of simulated sensors with command handling"""

    def __init__(self, num_cold_rooms: int = 10, num_trucks: int = 12):
        self.sensors = []
        self.client: Optional[mqtt.Client] = None
        self.running = False

        # Index for fast command lookup
        self._sensor_index = {}

        sites = ["site1", "site2", "site3"]
        for i in range(num_cold_rooms):
            site = sites[i % len(sites)]
            room_id = f"room{i + 1}"
            target_temp = random.choice([-20, -18, -15, 2, 4, 8])
            sensor = ColdRoomSensor(site, room_id, target_temp)
            self.sensors.append(sensor)
            # Index by multiple keys for flexible matching
            self._sensor_index[sensor.sensor_id] = sensor
            self._sensor_index[f"{site}-{room_id}"] = sensor
            self._sensor_index[f"cold-room-{site}-{room_id}"] = sensor

        for i in range(num_trucks):
            truck_id = f"truck{i + 1:02d}"
            target_temp = random.choice([-18, -15, 2, 4])
            sensor = TruckSensor(truck_id, target_temp=target_temp)
            self.sensors.append(sensor)
            self._sensor_index[sensor.sensor_id] = sensor
            self._sensor_index[truck_id] = sensor
            self._sensor_index[sensor.truck_id] = sensor

        print(f"Initialized {len(self.sensors)} sensors:")
        print(f"  - {num_cold_rooms} cold rooms across {len(sites)} sites")
        print(f"  - {num_trucks} refrigerated trucks")

    def _find_sensor(self, asset_id: str):
        """Find a sensor by various ID formats."""
        # Direct lookup
        sensor = self._sensor_index.get(asset_id)
        if sensor:
            return sensor

        # Try case-insensitive and partial match
        asset_lower = asset_id.lower().replace("-", "").replace("_", "")
        for key, s in self._sensor_index.items():
            if key.lower().replace("-", "").replace("_", "") == asset_lower:
                return s

        return None

    def _setup_command_handler(self):
        """Subscribe to command topics for simulation control."""

        def on_command(client, userdata, msg):
            try:
                topic = msg.topic
                payload = json.loads(msg.payload.decode("utf-8"))
                action = payload.get("action", "")
                duration = payload.get("duration_seconds", 60)

                parts = topic.split("/")
                if len(parts) < 3:
                    print(f"[CMD] Invalid command topic: {topic}")
                    return

                target_id = parts[1]
                command_type = parts[2]

                print(f"[CMD] Received: {command_type} {action} on {target_id} for {duration}s")

                if command_type == "door":
                    self._handle_door_command(target_id, action, duration)
                elif command_type == "compressor":
                    self._handle_compressor_command(target_id, action, duration)
                elif command_type == "power":
                    self._handle_power_command(target_id, action, duration)
                else:
                    print(f"[CMD] Unknown command type: {command_type}")

            except Exception as e:
                print(f"[CMD] Error handling command: {e}")

        self.client.subscribe("commands/#")
        self.client.message_callback_add("commands/#", on_command)
        print("[CMD] Subscribed to commands/# for simulation control")

    def _handle_door_command(self, asset_id: str, action: str, duration: int):
        """Handle door open/close commands."""
        sensor = self._find_sensor(asset_id)
        if not sensor:
            print(f"[CMD] Unknown asset for door command: {asset_id}")
            return

        if action == "open":
            sensor._cmd_door_open = True
            sensor.door_open = True
            sensor.door_open_since = time.time()
            print(f"[CMD] ✓ Opened door on {asset_id} for {duration}s")

            def auto_close():
                sensor._cmd_door_open = None
                sensor.door_open = False
                sensor.door_open_since = None
                print(f"[CMD] ✓ Auto-closed door on {asset_id}")

            threading.Timer(duration, auto_close).start()

        elif action == "close":
            sensor._cmd_door_open = None
            sensor.door_open = False
            sensor.door_open_since = None
            print(f"[CMD] ✓ Closed door on {asset_id}")

    def _handle_compressor_command(self, asset_id: str, action: str, duration: int):
        """Handle compressor fail/restore commands."""
        sensor = self._find_sensor(asset_id)
        if not sensor:
            print(f"[CMD] Unknown asset for compressor command: {asset_id}")
            return

        if action == "fail":
            sensor._cmd_compressor_off = True
            sensor.compressor_running = False
            print(f"[CMD] ✓ Compressor failed on {asset_id} for {duration}s")

            def auto_restore():
                sensor._cmd_compressor_off = None
                sensor.compressor_running = True
                print(f"[CMD] ✓ Compressor restored on {asset_id}")

            threading.Timer(duration, auto_restore).start()

        elif action == "restore":
            sensor._cmd_compressor_off = None
            sensor.compressor_running = True
            print(f"[CMD] ✓ Compressor restored on {asset_id}")

    def _handle_power_command(self, site_id: str, action: str, duration: int):
        """Handle power outage/restore commands for a site."""
        affected = [s for s in self.sensors
                    if isinstance(s, ColdRoomSensor) and s.site_id == site_id]

        if not affected:
            print(f"[CMD] No cold rooms found at site: {site_id}")
            return

        if action == "outage":
            for s in affected:
                s._cmd_power_outage = True
                s.compressor_running = False
                s.power_status = "outage"
            print(f"[CMD] ✓ Power outage at {site_id}, {len(affected)} rooms affected for {duration}s")

            def auto_restore():
                for s in affected:
                    s._cmd_power_outage = None
                    s.compressor_running = True
                    s.power_status = "normal"
                print(f"[CMD] ✓ Power restored at {site_id}")

            threading.Timer(duration, auto_restore).start()

        elif action == "restore":
            for s in affected:
                s._cmd_power_outage = None
                s.compressor_running = True
                s.power_status = "normal"
            print(f"[CMD] ✓ Power restored at {site_id}")

    def connect_mqtt(self):
        """Establish MQTT connection"""
        self.client = mqtt.Client(
            client_id=f"cold-chain-simulator-{random.randint(1000, 9999)}",
            protocol=mqtt.MQTTv311
        )

        def on_connect(client, userdata, flags, rc):
            if rc == 0:
                print(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")
                # Re-subscribe on reconnect
                self._setup_command_handler()
            else:
                print(f"Failed to connect, return code: {rc}")

        def on_publish(client, userdata, mid):
            pass

        self.client.on_connect = on_connect
        self.client.on_publish = on_publish

        try:
            self.client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
            self.client.loop_start()
            return True
        except Exception as e:
            print(f"MQTT connection error: {e}")
            return False

    def publish_telemetry(self, sensor, telemetry):
        """Publish sensor telemetry to MQTT"""
        if not self.client:
            return False

        topic = sensor.mqtt_topic
        payload = json.dumps(asdict(telemetry))

        result = self.client.publish(topic, payload, qos=MQTT_QOS)

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            return True
        else:
            print(f"Publish failed for {topic}: {result.rc}")
            return False

    def run(self):
        """Main simulation loop"""
        if not self.connect_mqtt():
            print("Failed to connect to MQTT broker. Exiting.")
            return

        self.running = True
        iteration = 0

        print(f"\nStarting telemetry simulation (interval: {PUBLISH_INTERVAL}s)")
        print(f"Command handling: ACTIVE (listening on commands/#)")
        print("-" * 60)

        try:
            while self.running:
                iteration += 1
                published = 0

                for sensor in self.sensors:
                    telemetry = sensor.simulate_step()
                    if self.publish_telemetry(sensor, telemetry):
                        published += 1

                if iteration % 10 == 0:
                    truck = next((s for s in self.sensors if isinstance(s, TruckSensor)), None)
                    room = next((s for s in self.sensors if isinstance(s, ColdRoomSensor)), None)

                    print(f"\n[Iteration {iteration}] Published {published}/{len(self.sensors)} messages")
                    if truck:
                        print(f"  Truck {truck.truck_id}: {truck.current_temp:.1f}°C, "
                              f"GPS: ({truck.latitude:.4f}, {truck.longitude:.4f}), "
                              f"Speed: {truck.speed:.0f} km/h, "
                              f"Door: {'OPEN' if truck.door_open else 'closed'}, "
                              f"Compressor: {'ON' if truck.compressor_running else 'OFF'}")
                    if room:
                        print(f"  Room {room.room_id}: {room.current_temp:.1f}°C, "
                              f"Door: {'OPEN' if room.door_open else 'closed'}, "
                              f"Compressor: {'ON' if room.compressor_running else 'OFF'}, "
                              f"Power: {room.power_status}")

                    # Show any active command overrides
                    cmd_active = []
                    for s in self.sensors:
                        if getattr(s, '_cmd_door_open', None) is not None:
                            name = getattr(s, 'truck_id', None) or s.sensor_id
                            cmd_active.append(f"{name}:door_open")
                        if getattr(s, '_cmd_compressor_off', None) is not None:
                            name = getattr(s, 'truck_id', None) or s.sensor_id
                            cmd_active.append(f"{name}:compressor_off")
                        if getattr(s, '_cmd_power_outage', None) is not None:
                            cmd_active.append(f"{s.sensor_id}:power_outage")
                    if cmd_active:
                        print(f"  [Active Commands] {', '.join(cmd_active)}")

                time.sleep(PUBLISH_INTERVAL)

        except KeyboardInterrupt:
            print("\n\nShutting down simulator...")
        finally:
            self.running = False
            if self.client:
                self.client.loop_stop()
                self.client.disconnect()
            print("Simulator stopped.")

    def stop(self):
        self.running = False


def main():
    num_rooms = int(os.getenv("NUM_COLD_ROOMS", 10))
    num_trucks = int(os.getenv("NUM_TRUCKS", 12))

    print("=" * 60)
    print("Cold Chain Digital Twin - Edge Layer Simulator")
    print("=" * 60)
    print(f"\nConfiguration:")
    print(f"  MQTT Broker: {MQTT_BROKER}:{MQTT_PORT}")
    print(f"  QoS Level: {MQTT_QOS}")
    print(f"  Publish Interval: {PUBLISH_INTERVAL}s")
    print(f"  Cold Rooms: {num_rooms}")
    print(f"  Trucks: {num_trucks}")
    print(f"  Command Handling: ENABLED (commands/#)")
    print()

    simulator = SensorFleetSimulator(num_rooms, num_trucks)
    simulator.run()


if __name__ == "__main__":
    main()