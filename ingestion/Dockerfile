FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY kafka_consumer.py .

RUN useradd -r -s /bin/false appuser
USER appuser

ENV PYTHONUNBUFFERED=1

CMD ["python", "kafka_consumer.py"]