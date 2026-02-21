"""
Cold Chain Digital Twin - MQTT to Kafka Bridge
Subscribes to MQTT topics and produces to Kafka
"""

import os
import json
import logging
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from confluent_kafka import Producer

# Configuration
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC_TRUCKS = os.getenv("KAFKA_TOPIC_TRUCKS", "coldchain.telemetry.trucks")
KAFKA_TOPIC_ROOMS = os.getenv("KAFKA_TOPIC_ROOMS", "coldchain.telemetry.rooms")
KAFKA_TOPIC_ALERTS = os.getenv("KAFKA_TOPIC_ALERTS", "coldchain.alerts")

# Anomaly thresholds
TEMP_THRESHOLD_FROZEN = -10.0
TEMP_THRESHOLD_CHILLED = 8.0

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Kafka Producer
producer = Producer({
    'bootstrap.servers': KAFKA_BOOTSTRAP_SERVERS,
    'client.id': 'mqtt-kafka-bridge',
    'acks': 'all',
})


def delivery_callback(err, msg):
    if err:
        logger.error(f"Kafka delivery failed: {err}")


def detect_anomalies(payload: dict) -> list:
    anomalies = []
    temp = payload.get("temperature_c")
    door_open = payload.get("door_open", False)
    asset_type = payload.get("asset_type")

    if asset_type == "refrigerated_truck" and temp is not None:
        if temp > TEMP_THRESHOLD_FROZEN:
            anomalies.append({
                "type": "TEMP_BREACH",
                "severity": "HIGH" if temp > 0 else "MEDIUM",
                "message": f"Truck temp {temp}°C exceeds {TEMP_THRESHOLD_FROZEN}°C",
                "value": temp
            })

    elif asset_type == "cold_room" and temp is not None:
        if temp > TEMP_THRESHOLD_CHILLED:
            anomalies.append({
                "type": "TEMP_BREACH",
                "severity": "HIGH" if temp > 15 else "MEDIUM",
                "message": f"Room temp {temp}°C exceeds {TEMP_THRESHOLD_CHILLED}°C",
                "value": temp
            })

    if door_open and payload.get("compressor_running"):
        anomalies.append({
            "type": "DOOR_OPEN",
            "severity": "LOW",
            "message": "Door open while compressor running"
        })

    return anomalies


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        logger.info(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")
        client.subscribe("fleet/+/telemetry")
        client.subscribe("warehouse/+/room/+/telemetry")
        logger.info("Subscribed to telemetry topics")
    else:
        logger.error(f"MQTT connection failed: {rc}")


def on_message(client, userdata, msg):
    try:
        topic = msg.topic
        payload = json.loads(msg.payload.decode('utf-8'))

        payload['mqtt_topic'] = topic
        payload['ingested_at'] = datetime.now(timezone.utc).isoformat() + 'Z'

        # Route to Kafka topic
        if topic.startswith("fleet/"):
            kafka_topic = KAFKA_TOPIC_TRUCKS
            key = payload.get("truck_id", "unknown")
        elif topic.startswith("warehouse/"):
            kafka_topic = KAFKA_TOPIC_ROOMS
            key = payload.get("sensor_id", "unknown")
        else:
            return

        # Send to Kafka
        producer.produce(
            topic=kafka_topic,
            key=key.encode('utf-8'),
            value=json.dumps(payload).encode('utf-8'),
            callback=delivery_callback
        )

        # Check for anomalies
        anomalies = detect_anomalies(payload)
        for anomaly in anomalies:
            alert = {
                "alert_id": f"{key}-{anomaly['type']}-{datetime.now(timezone.utc).timestamp()}",
                "asset_id": key,
                "asset_type": payload.get("asset_type"),
                "anomaly": anomaly,
                "detected_at": datetime.now(timezone.utc).isoformat() + 'Z'
            }
            producer.produce(
                topic=KAFKA_TOPIC_ALERTS,
                key=key.encode('utf-8'),
                value=json.dumps(alert).encode('utf-8'),
                callback=delivery_callback
            )
            logger.warning(f"Alert: {anomaly['type']} for {key}")

        producer.poll(0)

    except Exception as e:
        logger.error(f"Error processing message: {e}")


def main():
    logger.info("=" * 60)
    logger.info("MQTT-Kafka Bridge Starting")
    logger.info("=" * 60)
    logger.info(f"MQTT: {MQTT_BROKER}:{MQTT_PORT}")
    logger.info(f"Kafka: {KAFKA_BOOTSTRAP_SERVERS}")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        producer.flush()
        client.disconnect()


if __name__ == "__main__":
    main()