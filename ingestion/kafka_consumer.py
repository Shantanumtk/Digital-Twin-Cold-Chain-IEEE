"""
Cold Chain Digital Twin - Kafka to MongoDB Consumer
Consumes telemetry from Kafka and stores in MongoDB
"""

import os
import json
import logging
from datetime import datetime, timezone

from confluent_kafka import Consumer, KafkaException
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

# Configuration
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "coldchain-ingestion")
KAFKA_TOPICS = os.getenv("KAFKA_TOPICS", "coldchain.telemetry.trucks,coldchain.telemetry.rooms,coldchain.alerts")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://mongodb:27017")
MONGO_DB = os.getenv("MONGO_DB", "coldchain")

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def connect_mongodb():
    """Connect to MongoDB with retry"""
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        logger.info(f"Connected to MongoDB at {MONGO_URI}")
        return client
    except ConnectionFailure as e:
        logger.error(f"MongoDB connection failed: {e}")
        raise


def process_telemetry(db, message: dict):
    """Process telemetry message and update Digital Twin state"""
    
    # Insert raw telemetry
    telemetry_doc = {
        **message,
        "created_at": datetime.now(timezone.utc)
    }
    db.telemetry.insert_one(telemetry_doc)
    
    # Update Digital Twin state (upsert current state)
    asset_id = message.get("truck_id") or message.get("sensor_id")
    asset_type = message.get("asset_type")
    
    if asset_id:
        update_doc = {
            "$set": {
                "type": asset_type,
                "current_state": {
                    "temperature_c": message.get("temperature_c"),
                    "humidity_pct": message.get("humidity_pct"),
                    "door_open": message.get("door_open"),
                    "compressor_running": message.get("compressor_running"),
                },
                "last_updated": datetime.now(timezone.utc),
                "mqtt_topic": message.get("mqtt_topic")
            },
            "$inc": {"message_count": 1}
        }
        
        # Add location for trucks
        if message.get("latitude") and message.get("longitude"):
            update_doc["$set"]["current_state"]["location"] = {
                "type": "Point",
                "coordinates": [message.get("longitude"), message.get("latitude")]
            }
            update_doc["$set"]["current_state"]["speed_kmh"] = message.get("speed_kmh")
        
        db.assets.update_one(
            {"_id": asset_id},
            update_doc,
            upsert=True
        )


def process_alert(db, message: dict):
    """Process alert message"""
    alert_doc = {
        **message,
        "created_at": datetime.now(timezone.utc),
        "acknowledged": False
    }
    db.alerts.insert_one(alert_doc)
    logger.warning(f"Alert stored: {message.get('anomaly', {}).get('type')} for {message.get('asset_id')}")


def main():
    """Main consumer loop"""
    logger.info("=" * 60)
    logger.info("Kafka Consumer Starting")
    logger.info("=" * 60)
    logger.info(f"Kafka: {KAFKA_BOOTSTRAP_SERVERS}")
    logger.info(f"Topics: {KAFKA_TOPICS}")
    logger.info(f"MongoDB: {MONGO_URI}")
    
    # Connect to MongoDB
    mongo_client = connect_mongodb()
    db = mongo_client[MONGO_DB]
    
    # Kafka consumer config
    consumer_config = {
        'bootstrap.servers': KAFKA_BOOTSTRAP_SERVERS,
        'group.id': KAFKA_GROUP_ID,
        'auto.offset.reset': 'earliest',
        'enable.auto.commit': True,
    }
    
    consumer = Consumer(consumer_config)
    consumer.subscribe(KAFKA_TOPICS.split(','))
    
    logger.info("Consumer started, waiting for messages...")
    
    message_count = 0
    
    try:
        while True:
            msg = consumer.poll(1.0)
            
            if msg is None:
                continue
            if msg.error():
                logger.error(f"Consumer error: {msg.error()}")
                continue
            
            try:
                topic = msg.topic()
                value = json.loads(msg.value().decode('utf-8'))
                
                if topic == "coldchain.alerts":
                    process_alert(db, value)
                else:
                    process_telemetry(db, value)
                
                message_count += 1
                if message_count % 100 == 0:
                    logger.info(f"Processed {message_count} messages")
                    
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON: {e}")
            except Exception as e:
                logger.error(f"Processing error: {e}")
                
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        consumer.close()
        mongo_client.close()


if __name__ == "__main__":
    main()