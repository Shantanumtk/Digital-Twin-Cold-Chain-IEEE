"""
Kafka MCP Tools — Read streaming events and alerts from Kafka topics.
Uses confluent-kafka (synchronous) to avoid async deadlock issues.
"""

import os
import json
from confluent_kafka import Consumer, TopicPartition, KafkaException

KAFKA_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

TOPICS = {
    "trucks": "coldchain.telemetry.trucks",
    "rooms": "coldchain.telemetry.rooms",
    "alerts": "coldchain.alerts",
}


def read_recent_events(topic_key: str = "alerts", count: int = 10) -> str:
    """Read the most recent events from a Kafka topic.

    Args:
        topic_key: One of 'trucks', 'rooms', or 'alerts' (default 'alerts')
        count: Number of recent messages to read (default 10)

    Returns:
        JSON string with recent Kafka messages.
    """
    topic = TOPICS.get(topic_key, topic_key)

    consumer = Consumer({
        "bootstrap.servers": KAFKA_SERVERS,
        "group.id": f"mcp-agent-reader-{topic_key}",
        "auto.offset.reset": "latest",
        "enable.auto.commit": False,
        "session.timeout.ms": 10000,
    })

    messages = []
    try:
        # Get topic metadata and partitions
        metadata = consumer.list_topics(topic, timeout=5)
        if topic not in metadata.topics:
            return json.dumps({"error": f"Topic {topic} not found"})

        topic_metadata = metadata.topics[topic]
        partitions = [TopicPartition(topic, p) for p in topic_metadata.partitions]

        # Get end offsets
        consumer.assign(partitions)
        end_offsets = {}
        for tp in partitions:
            lo, hi = consumer.get_watermark_offsets(tp, timeout=5)
            end_offsets[tp.partition] = hi

        # Seek to (end - count) for each partition
        msgs_per_partition = max(1, count // len(partitions)) + 1
        for tp in partitions:
            hi = end_offsets.get(tp.partition, 0)
            seek_to = max(0, hi - msgs_per_partition)
            consumer.seek(TopicPartition(topic, tp.partition, seek_to))

        # Poll for messages
        empty_polls = 0
        while len(messages) < count and empty_polls < 3:
            msg = consumer.poll(2.0)
            if msg is None:
                empty_polls += 1
                continue
            if msg.error():
                continue

            try:
                value = json.loads(msg.value().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                value = {"raw": msg.value().decode("utf-8", errors="replace")}

            messages.append({
                "topic": msg.topic(),
                "partition": msg.partition(),
                "offset": msg.offset(),
                "timestamp": msg.timestamp()[1],
                "value": value,
            })
            empty_polls = 0

    except KafkaException as e:
        return json.dumps({"error": f"Kafka error: {str(e)}"})
    except Exception as e:
        return json.dumps({"error": f"Failed to read from Kafka topic {topic}: {str(e)}"})
    finally:
        consumer.close()

    if not messages:
        return json.dumps({"message": f"No recent messages on topic {topic}"})

    # Return most recent first
    messages.sort(key=lambda m: m.get("offset", 0), reverse=True)
    return json.dumps(messages[:count], default=str)


def list_topics() -> str:
    """List available Kafka topics for the cold chain system."""
    return json.dumps({
        "available_topics": TOPICS,
        "usage": "Use topic_key (e.g. 'alerts') with read_recent_events"
    })