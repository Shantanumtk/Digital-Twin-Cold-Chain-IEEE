"""
Cold Chain Digital Twin - Edge Layer Sensor Simulator (Phase 4 patched)

Changes from original:
  - trace_id injected into every MQTT publish (Phase 4)
  - publish_ts_ms for end-to-end latency measurement (Phase 4)
  - Ground truth Kafka emission on fault injection (Phase 2)
  - Temperature override command handler (Phase 2 eval harness)
"""

import json
import time
import random
import threading
import os
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional

import paho.mqtt.client as mqtt

# Optional Kafka producer for ground truth emission (Phase 2)
try:
    from confluent_kafka import Producer as KafkaProducer
    _kafka_producer = KafkaProducer({
        'bootstrap.servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092'),
        'client.id': 'simulator-ground-truth',
        'acks': '1',
    })
    _kafka_available = True
    print("[SIMULATOR] Kafka ground truth emitter: ENABLED")
except ImportError:
    _kafka_available = False
    _kafka_producer = None
    print("[SIMULATOR] Kafka not available — ground truth emission disabled")

GROUND_TRUTH_TOPIC = "coldchain.ground.truth"

# Configuration from environment
MQTT_BROKER      = os.getenv("MQTT_BROKER",      "localhost")
MQTT_PORT        = int(os.getenv("MQTT_PORT",     1883))
MQTT_QOS         = int(os.getenv("MQTT_QOS",      1))
PUBLISH_INTERVAL = float(os.getenv("PUBLISH_INTERVAL", 5.0))


@dataclass
class ColdRoomTelemetry:
    sensor_id:              str
    site_id:                str
    room_id:                str
    asset_type:             str
    timestamp:              str
    temperature_c:          float
    humidity_pct:           float
    door_open:              bool
    compressor_running:     bool
    compressor_cycle_count: int
    power_status:           str


@dataclass
class TruckTelemetry:
    sensor_id:          str
    truck_id:           str
    fleet_id:           str
    asset_type:         str
    timestamp:          str
    temperature_c:      float
    humidity_pct:       float
    door_open:          bool
    compressor_running: bool
    latitude:           float
    longitude:          float
    speed_kmh:          float
    engine_running:     bool


class ColdRoomSensor:
    def __init__(self, site_id: str, room_id: str, target_temp: float = -20.0):
        self.sensor_id   = f"sensor-room-{site_id}-{room_id}"
        self.site_id     = site_id
        self.room_id     = room_id
        self.target_temp = target_temp
        self.current_temp= target_temp + random.uniform(-0.5, 0.5)
        self.humidity    = random.uniform(45, 55)
        self.door_open   = False
        self.compressor_running = True
        self.compressor_cycles  = 0
        self.power_status       = "normal"
        self.door_open_since: Optional[float] = None

        self._cmd_door_open:      Optional[bool] = None
        self._cmd_compressor_off: Optional[bool] = None
        self._cmd_power_outage:   Optional[bool] = None
        self._cmd_temp_override:  Optional[float]= None  # Phase 2

        self.cooling_rate      = 0.3
        self.warming_rate      = 0.1
        self.door_warming_rate = 0.8

    def simulate_step(self):
        if self._cmd_door_open is not None:
            self.door_open = self._cmd_door_open
        if self._cmd_compressor_off is not None:
            self.compressor_running = not self._cmd_compressor_off
        if self._cmd_power_outage is not None:
            if self._cmd_power_outage:
                self.compressor_running = False
                self.power_status = "outage"

        # Phase 2: temperature override command
        if self._cmd_temp_override is not None:
            self.current_temp = self._cmd_temp_override
        else:
            if self._cmd_door_open is None:
                self._simulate_door_events()
            if self._cmd_compressor_off is None and self._cmd_power_outage is None:
                self._simulate_compressor_events()
            if self._cmd_power_outage is None:
                self._simulate_power_events()

            if self.door_open:
                self.current_temp += random.uniform(0.3, self.door_warming_rate)
                self.humidity     += random.uniform(1, 3)
            elif self.compressor_running:
                if self.current_temp > self.target_temp:
                    self.current_temp -= random.uniform(0.1, self.cooling_rate)
            else:
                self.current_temp += random.uniform(0.05, self.warming_rate)

        if self.compressor_running and not self.door_open:
            self.humidity = max(40, self.humidity - random.uniform(0, 0.5))
        self.humidity = max(30, min(95, self.humidity))

        return ColdRoomTelemetry(
            sensor_id             = self.sensor_id,
            site_id               = self.site_id,
            room_id               = self.room_id,
            asset_type            = "cold_room",
            timestamp             = datetime.now(timezone.utc).isoformat(),
            temperature_c         = round(self.current_temp + random.gauss(0, 0.1), 2),
            humidity_pct          = round(self.humidity     + random.gauss(0, 0.5), 1),
            door_open             = self.door_open,
            compressor_running    = self.compressor_running,
            compressor_cycle_count= self.compressor_cycles,
            power_status          = self.power_status,
        )

    def _simulate_door_events(self):
        if self.door_open:
            if self.door_open_since:
                if time.time() - self.door_open_since > random.uniform(30, 120):
                    self.door_open = False
                    self.door_open_since = None
        elif random.random() < 0.02:
            self.door_open = True
            self.door_open_since = time.time()

    def _simulate_compressor_events(self):
        if self.compressor_running:
            if self.current_temp < self.target_temp - 2 and random.random() < 0.1:
                self.compressor_running = False
        else:
            if self.current_temp > self.target_temp + 1:
                self.compressor_running = True
                self.compressor_cycles += 1

    def _simulate_power_events(self):
        if self.power_status == "normal":
            if random.random() < 0.005:
                self.power_status = random.choice(["brownout", "backup"])
        elif random.random() < 0.2:
            self.power_status = "normal"

    @property
    def mqtt_topic(self) -> str:
        return f"warehouse/{self.site_id}/room/{self.room_id}/telemetry"


class TruckSensor:
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
        ],
    }

    def __init__(self, truck_id: str, fleet_id: str = "fleet1",
                 target_temp: float = -18.0, route_name: str = None):
        self.sensor_id   = f"sensor-truck-{truck_id}"
        self.truck_id    = truck_id
        self.fleet_id    = fleet_id
        self.target_temp = target_temp
        self.current_temp= target_temp + random.uniform(-0.5, 0.5)
        self.humidity    = random.uniform(40, 50)
        self.door_open   = False
        self.compressor_running = True
        self.engine_running     = True

        self._cmd_door_open:      Optional[bool]  = None
        self._cmd_compressor_off: Optional[bool]  = None
        self._cmd_temp_override:  Optional[float] = None  # Phase 2

        self.route_name   = route_name or random.choice(list(self.ROUTES.keys()))
        self.route        = self.ROUTES[self.route_name]
        self.route_index  = 0
        self.route_progress = 0.0
        self.speed        = random.uniform(60, 90)
        self.latitude, self.longitude = self.route[0]

        self.cooling_rate      = 0.25
        self.warming_rate      = 0.15
        self.door_warming_rate = 1.0
        self.door_open_since: Optional[float] = None

    def simulate_step(self):
        if self._cmd_door_open is not None:
            self.door_open = self._cmd_door_open
        if self._cmd_compressor_off is not None:
            self.compressor_running = not self._cmd_compressor_off

        self._simulate_movement()

        if self._cmd_door_open is None:
            self._simulate_door_events()

        # Phase 2: temperature override
        if self._cmd_temp_override is not None:
            self.current_temp = self._cmd_temp_override
        else:
            self._simulate_thermal_dynamics()

        return TruckTelemetry(
            sensor_id          = self.sensor_id,
            truck_id           = self.truck_id,
            fleet_id           = self.fleet_id,
            asset_type         = "refrigerated_truck",
            timestamp          = datetime.now(timezone.utc).isoformat(),
            temperature_c      = round(self.current_temp + random.gauss(0, 0.15), 2),
            humidity_pct       = round(self.humidity     + random.gauss(0, 0.8),  1),
            door_open          = self.door_open,
            compressor_running = self.compressor_running,
            latitude           = round(self.latitude,  6),
            longitude          = round(self.longitude, 6),
            speed_kmh          = round(self.speed, 1) if self.engine_running else 0,
            engine_running     = self.engine_running,
        )

    def _simulate_movement(self):
        if not self.engine_running:
            self.speed = 0
            return
        self.route_progress += random.uniform(0.01, 0.03)
        if self.route_progress >= 1.0:
            self.route_index   = (self.route_index + 1) % len(self.route)
            self.route_progress = 0.0
            if random.random() < 0.3:
                self.engine_running = False
                if self._cmd_door_open is None:
                    self.door_open       = True
                    self.door_open_since = time.time()
        cur  = self.route[self.route_index]
        nxt  = self.route[(self.route_index + 1) % len(self.route)]
        self.latitude  = cur[0] + (nxt[0] - cur[0]) * self.route_progress
        self.longitude = cur[1] + (nxt[1] - cur[1]) * self.route_progress
        self.speed     = max(0, min(120, self.speed + random.uniform(-5, 5)))

    def _simulate_door_events(self):
        if self.door_open and self.door_open_since:
            if time.time() - self.door_open_since > random.uniform(60, 300):
                self.door_open       = False
                self.door_open_since = None
                self.engine_running  = True
                self.speed           = random.uniform(30, 50)

    def _simulate_thermal_dynamics(self):
        if self.door_open:
            self.current_temp += random.uniform(0.5, self.door_warming_rate)
            self.humidity     += random.uniform(2, 5)
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
    def __init__(self, num_cold_rooms: int = 10, num_trucks: int = 12):
        self.sensors        = []
        self.client         = None
        self.running        = False
        self._sensor_index  = {}

        sites = ["site1", "site2", "site3"]
        for i in range(num_cold_rooms):
            site   = sites[i % len(sites)]
            room_id= f"room{i + 1}"
            sensor = ColdRoomSensor(site, room_id, random.choice([-20, -18, -15, 2, 4, 8]))
            self.sensors.append(sensor)
            self._sensor_index[sensor.sensor_id]           = sensor
            self._sensor_index[f"{site}-{room_id}"]        = sensor
            self._sensor_index[f"cold-room-{site}-{room_id}"] = sensor

        for i in range(num_trucks):
            truck_id = f"truck{i + 1:02d}"
            sensor   = TruckSensor(truck_id, target_temp=random.choice([-18, -15, 2, 4]))
            self.sensors.append(sensor)
            self._sensor_index[sensor.sensor_id] = sensor
            self._sensor_index[truck_id]          = sensor
            self._sensor_index[sensor.truck_id]   = sensor

        print(f"Initialized {len(self.sensors)} sensors: {num_cold_rooms} rooms + {num_trucks} trucks")

    def _find_sensor(self, asset_id: str):
        sensor = self._sensor_index.get(asset_id)
        if sensor:
            return sensor
        al = asset_id.lower().replace("-", "").replace("_", "")
        for k, s in self._sensor_index.items():
            if k.lower().replace("-", "").replace("_", "") == al:
                return s
        return None

    def _emit_ground_truth(self, asset_id: str, fault_type: str,
                            expected_state: str, duration_seconds: int,
                            trace_id: str = None):
        """Phase 2: Emit labeled ground truth event to Kafka for eval harness."""
        if not _kafka_available or _kafka_producer is None:
            return
        event = {
            "trace_id":         trace_id or str(uuid.uuid4()),
            "asset_id":         asset_id,
            "fault_type":       fault_type,
            "injected_at":      datetime.now(timezone.utc).isoformat(),
            "expected_state":   expected_state,
            "duration_seconds": duration_seconds,
        }
        try:
            _kafka_producer.produce(
                topic = GROUND_TRUTH_TOPIC,
                key   = asset_id.encode("utf-8"),
                value = json.dumps(event).encode("utf-8"),
            )
            _kafka_producer.poll(0)
            print(f"[GROUND_TRUTH] Emitted {fault_type} for {asset_id}")
        except Exception as e:
            print(f"[GROUND_TRUTH] Kafka emit failed: {e}")

    def _setup_command_handler(self):
        def on_command(client, userdata, msg):
            try:
                topic   = msg.topic
                payload = json.loads(msg.payload.decode("utf-8"))
                action  = payload.get("action", "")
                duration= payload.get("duration_seconds", 60)
                parts   = topic.split("/")
                if len(parts) < 3:
                    return
                target_id    = parts[1]
                command_type = parts[2]
                trace_id     = payload.get("trace_id")  # Phase 2
                print(f"[CMD] {command_type} {action} on {target_id} for {duration}s")
                if command_type == "door":
                    self._handle_door_command(target_id, action, duration, trace_id)
                elif command_type == "compressor":
                    self._handle_compressor_command(target_id, action, duration, trace_id)
                elif command_type == "power":
                    self._handle_power_command(target_id, action, duration, trace_id)
                elif command_type == "temperature":
                    self._handle_temperature_command(target_id, action, payload, duration, trace_id)
            except Exception as e:
                print(f"[CMD] Error: {e}")

        self.client.subscribe("commands/#")
        self.client.message_callback_add("commands/#", on_command)
        print("[CMD] Subscribed to commands/#")

    def _handle_temperature_command(self, asset_id: str, action: str,
                                      payload: dict, duration: int,
                                      trace_id: str = None):
        """Phase 2: Override asset temperature for duration seconds."""
        sensor = self._find_sensor(asset_id)
        if not sensor:
            print(f"[CMD] Unknown asset for temperature command: {asset_id}")
            return
        value = float(payload.get("value", -5.0))
        if action == "set":
            sensor._cmd_temp_override = value
            # Determine expected state from value
            expected = "CRITICAL" if value > -10.0 else ("WARNING" if value > -15.0 else "NORMAL")
            self._emit_ground_truth(asset_id, "TEMP_BREACH", expected, duration, trace_id)
            print(f"[CMD] ✓ Set temperature on {asset_id} to {value}°C for {duration}s → {expected}")

            def auto_restore():
                sensor._cmd_temp_override = None
                print(f"[CMD] ✓ Temperature restored on {asset_id}")

            threading.Timer(duration, auto_restore).start()

    def _handle_door_command(self, asset_id: str, action: str, duration: int,
                              trace_id: str = None):
        sensor = self._find_sensor(asset_id)
        if not sensor:
            return
        if action == "open":
            sensor._cmd_door_open = True
            sensor.door_open       = True
            sensor.door_open_since = time.time()
            # Phase 2: emit ground truth
            self._emit_ground_truth(asset_id, "DOOR_FAULT", "CRITICAL", duration, trace_id)
            print(f"[CMD] ✓ Opened door on {asset_id} for {duration}s")

            def auto_close():
                sensor._cmd_door_open = None
                sensor.door_open       = False
                sensor.door_open_since = None
                print(f"[CMD] ✓ Auto-closed door on {asset_id}")

            threading.Timer(duration, auto_close).start()
        elif action == "close":
            sensor._cmd_door_open = None
            sensor.door_open       = False
            sensor.door_open_since = None

    def _handle_compressor_command(self, asset_id: str, action: str, duration: int,
                                    trace_id: str = None):
        sensor = self._find_sensor(asset_id)
        if not sensor:
            return
        if action == "fail":
            sensor._cmd_compressor_off = True
            sensor.compressor_running  = False
            # Phase 2: emit ground truth
            self._emit_ground_truth(asset_id, "COMPRESSOR_FAIL", "CRITICAL", duration, trace_id)
            print(f"[CMD] ✓ Compressor failed on {asset_id} for {duration}s")

            def auto_restore():
                sensor._cmd_compressor_off = None
                sensor.compressor_running  = True
                print(f"[CMD] ✓ Compressor restored on {asset_id}")

            threading.Timer(duration, auto_restore).start()
        elif action == "restore":
            sensor._cmd_compressor_off = None
            sensor.compressor_running  = True

    def _handle_power_command(self, site_id: str, action: str, duration: int,
                               trace_id: str = None):
        affected = [s for s in self.sensors
                    if isinstance(s, ColdRoomSensor) and s.site_id == site_id]
        if not affected:
            return
        if action == "outage":
            for s in affected:
                s._cmd_power_outage    = True
                s.compressor_running   = False
                s.power_status         = "outage"
                # Phase 2: emit ground truth per room
                self._emit_ground_truth(s.sensor_id, "POWER_OUTAGE", "CRITICAL", duration, trace_id)
            print(f"[CMD] ✓ Power outage at {site_id}, {len(affected)} rooms for {duration}s")

            def auto_restore():
                for s in affected:
                    s._cmd_power_outage  = None
                    s.compressor_running = True
                    s.power_status       = "normal"
                print(f"[CMD] ✓ Power restored at {site_id}")

            threading.Timer(duration, auto_restore).start()
        elif action == "restore":
            for s in affected:
                s._cmd_power_outage  = None
                s.compressor_running = True
                s.power_status       = "normal"

    def connect_mqtt(self):
        self.client = mqtt.Client(
            client_id=f"cold-chain-simulator-{random.randint(1000, 9999)}",
            protocol=mqtt.MQTTv311,
        )

        def on_connect(client, userdata, flags, rc):
            if rc == 0:
                print(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")
                self._setup_command_handler()
            else:
                print(f"Failed to connect, return code: {rc}")

        self.client.on_connect = on_connect
        try:
            self.client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
            self.client.loop_start()
            return True
        except Exception as e:
            print(f"MQTT connection error: {e}")
            return False

    def publish_telemetry(self, sensor, telemetry):
        """Phase 4: Add trace_id and publish_ts_ms to every message."""
        if not self.client:
            return False

        topic        = sensor.mqtt_topic
        payload_dict = asdict(telemetry)

        # Phase 4: inject trace_id and publish timestamp for latency measurement
        payload_dict["trace_id"]      = str(uuid.uuid4())
        payload_dict["publish_ts_ms"] = time.time() * 1000  # wall-clock ms

        payload = json.dumps(payload_dict)
        result  = self.client.publish(topic, payload, qos=MQTT_QOS)

        return result.rc == mqtt.MQTT_ERR_SUCCESS

    def run(self):
        if not self.connect_mqtt():
            print("Failed to connect to MQTT broker. Exiting.")
            return

        self.running = True
        iteration    = 0

        print(f"\nStarting telemetry (interval: {PUBLISH_INTERVAL}s)")
        print(f"Phase 4: trace_id + publish_ts_ms: ENABLED")
        print(f"Phase 2: ground truth Kafka emission: {'ENABLED' if _kafka_available else 'DISABLED'}")
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
                    room  = next((s for s in self.sensors if isinstance(s, ColdRoomSensor)), None)
                    print(f"\n[Iter {iteration}] Published {published}/{len(self.sensors)}")
                    if truck:
                        print(f"  {truck.truck_id}: {truck.current_temp:.1f}°C "
                              f"door={'OPEN' if truck.door_open else 'closed'} "
                              f"comp={'ON' if truck.compressor_running else 'OFF'}")
                    if room:
                        print(f"  {room.sensor_id}: {room.current_temp:.1f}°C "
                              f"power={room.power_status}")

                time.sleep(PUBLISH_INTERVAL)

        except KeyboardInterrupt:
            print("\nShutting down simulator...")
        finally:
            self.running = False
            if self.client:
                self.client.loop_stop()
                self.client.disconnect()
            if _kafka_available and _kafka_producer:
                _kafka_producer.flush()
            print("Simulator stopped.")

    def stop(self):
        self.running = False


def main():
    num_rooms  = int(os.getenv("NUM_COLD_ROOMS", 10))
    num_trucks = int(os.getenv("NUM_TRUCKS",     12))

    print("=" * 60)
    print("Cold Chain Digital Twin - Edge Layer Simulator")
    print("=" * 60)
    print(f"MQTT:             {MQTT_BROKER}:{MQTT_PORT}")
    print(f"Publish Interval: {PUBLISH_INTERVAL}s")
    print(f"Cold Rooms:       {num_rooms}")
    print(f"Trucks:           {num_trucks}")
    print(f"Ground Truth:     {'kafka' if _kafka_available else 'disabled'}")

    simulator = SensorFleetSimulator(num_rooms, num_trucks)
    simulator.run()


if __name__ == "__main__":
    main()
