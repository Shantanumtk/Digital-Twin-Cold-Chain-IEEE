FROM python:3.12-slim
WORKDIR /app

# Install system deps including docker CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    mosquitto-clients \
    curl \
    && curl -fsSL https://get.docker.com | sh \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

CMD ["python", "host.py"]