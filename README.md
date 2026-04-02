# ❄️ Cold Chain Digital Twin

> **Real-time AI-powered monitoring platform for cold chain logistics** — refrigerated trucks and cold storage rooms, built on AWS EKS with an intelligent MCP agent layer.

![Dashboard](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green?style=flat-square&logo=fastapi)
![Kubernetes](https://img.shields.io/badge/Kubernetes-1.32-blue?style=flat-square&logo=kubernetes)
![Terraform](https://img.shields.io/badge/Terraform-AWS-purple?style=flat-square&logo=terraform)
![Kafka](https://img.shields.io/badge/Apache-Kafka-black?style=flat-square&logo=apache-kafka)
![MongoDB](https://img.shields.io/badge/MongoDB-8.0-green?style=flat-square&logo=mongodb)

---

## 🌟 Overview

The Cold Chain Digital Twin is a graduate-level systems project (CPSC-597) that simulates, monitors, and intelligently manages a cold chain logistics fleet in real-time. It combines IoT sensor simulation, event-driven data pipelines, AI-powered natural language querying, and a professional-grade monitoring dashboard — all deployed on AWS using Infrastructure as Code.

### What it does
- **Simulates** refrigerated trucks and cold storage rooms with realistic physics-based temperature, humidity, door, and compressor telemetry
- **Ingests** telemetry via MQTT → Kafka → MongoDB in real-time
- **Computes** NORMAL / WARNING / CRITICAL asset states using configurable threshold profiles
- **Alerts** operations teams via email (AWS SNS) on CRITICAL state transitions
- **Visualizes** everything on a live dashboard with charts, maps, and animated asset diagrams
- **Answers** natural language queries ("Which trucks are critical right now?") via an AI MCP agent
- **Controls** the simulator ("Open truck03's door") via an admin-only Simulator portal

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AWS us-west-2                              │
│                                                                     │
│  ┌──────────────────┐     ┌───────────────────────────────────────┐ │
│  │   MQTT EC2       │     │           EKS Cluster                 │ │
│  │                  │     │                                       │ │
│  │  Mosquitto MQTT  │────▶│  Kafka (KRaft)  ──▶  Bridge Service   │ │
│  │  MCP Agent       │     │  Kafka Consumer ──▶  MongoDB Client   │ │
│  │  Sensor Sim      │     │  State Engine   ──▶  Redis + REST API │ │
│  │  (docker-compose)│     │  Dashboard      ──▶  Next.js 14       │ │
│  └──────────────────┘     └───────────────────────────────────────┘ │
│                                      │                              │
│  ┌──────────────────┐                ▼                              │
│  │  MongoDB EC2     │◀──────  Telemetry + Alerts                    │
│  │  (private subnet)│                                               │
│  └──────────────────┘         AWS SNS ──▶ Email Alerts              │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Pipeline
```
Sensor Simulator
      │
      ▼ MQTT (port 1883)
Mosquitto Broker (EC2)
      │
      ▼ Kafka Topic: coldchain.telemetry.*
Kafka KRaft (EKS StatefulSet)
      │
      ├──▶ Kafka Consumer ──▶ MongoDB (telemetry, alerts history)
      │
      └──▶ State Engine ──▶ Redis (live state) ──▶ REST API ──▶ Dashboard
```

---

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Infrastructure** | AWS EKS, EC2, VPC, ECR, SNS, IAM — all via Terraform |
| **Message Broker** | Mosquitto MQTT on EC2 |
| **Event Streaming** | Apache Kafka KRaft (single broker, EKS StatefulSet) |
| **Database** | MongoDB 8.0 (EC2, private subnet) |
| **Cache / State** | Redis (EKS StatefulSet) |
| **State Engine** | FastAPI + Python 3.11 |
| **AI Agent** | LangGraph + MCP (Model Context Protocol) |
| **Dashboard** | Next.js 14, React, TypeScript |
| **Auth** | NextAuth.js (JWT, MongoDB-backed) |
| **Notifications** | AWS SNS (email on CRITICAL transitions) |
| **IaC** | Terraform (modular, ~800 lines) |
| **CI/CD** | Bash deploy script (14-step idempotent) |

---

## 📦 Project Structure

```
Digital-Twin-Cold-Chain-mcp/
├── terraform/                  # All AWS infrastructure
│   ├── main.tf                 # Provider + S3 backend
│   ├── vpc.tf                  # VPC, subnets, NAT
│   ├── eks.tf                  # EKS cluster
│   ├── eks-node-groups.tf      # Node groups (t3.medium)
│   ├── eks-iam.tf              # IAM roles for EKS
│   ├── ec2.tf                  # MQTT EC2 + MongoDB EC2
│   ├── sns.tf                  # SNS topic + email subscription
│   └── variables.tf
├── simulator/                  # Sensor simulation
│   ├── simulator.py            # Trucks + cold rooms physics model
│   └── docker-compose.yml
├── bridge/                     # MQTT → Kafka bridge
│   ├── bridge.py
│   └── Dockerfile
├── ingestion/                  # Kafka → MongoDB consumer
│   ├── consumer.py
│   └── Dockerfile
├── state-engine/               # FastAPI state engine
│   ├── main.py                 # REST API + Kafka consumer thread
│   ├── state_calculator.py     # NORMAL/WARNING/CRITICAL logic
│   ├── profile_loader.py       # Threshold profile YAML loader
│   ├── redis_client.py         # Redis state management
│   ├── mongo_client.py         # MongoDB queries
│   ├── sns_publisher.py        # AWS SNS publisher
│   ├── requirements.txt
│   └── Dockerfile
├── mcp-agent/                  # AI MCP Agent (runs on MQTT EC2)
│   ├── host.py                 # FastAPI MCP host
│   ├── query_agent.py          # NL query agent (Redis/Mongo/Kafka tools)
│   ├── simulator_agent.py      # Simulator control agent
│   └── Dockerfile
├── dashboard/                  # Next.js 14 dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx        # Main dashboard page
│   │   │   ├── login/          # Login page + form
│   │   │   ├── api/
│   │   │   │   ├── auth/       # NextAuth + seed route
│   │   │   │   └── chat/       # AI chat proxy
│   │   ├── components/
│   │   │   ├── dashboard/
│   │   │   │   ├── pages/      # All page components
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── TopNav.tsx
│   │   │   ├── AssetDetailModal.tsx
│   │   │   ├── FloatingChat.tsx
│   │   │   └── FloatingChatBubble.tsx
│   │   ├── middleware.ts        # RBAC route protection
│   │   └── types/
│   │       └── next-auth.d.ts  # Session type augmentation
│   └── Dockerfile
├── profiles/                   # Threshold YAML profiles
│   ├── frozen-logistics.yaml
│   ├── pharma.yaml
│   └── demo.yaml
├── k8s/                        # Kubernetes manifests
│   ├── kafka.yaml
│   ├── redis.yaml
│   ├── state-engine.yaml
│   ├── dashboard.yaml
│   └── ...
└── scripts/
    ├── deploy-script.sh        # Full 14-step deploy
    ├── destroy-script.sh       # Full teardown
    └── setup-irsa-sns.sh       # IRSA setup for SNS
```

---

## ✨ Features

### 🖥️ Dashboard Pages
| Page | Description |
|------|-------------|
| **Dashboard** | Live asset grid with state badges, temperature trends, active alerts panel |
| **Fleet** | Truck-specific view with GPS location, route history, performance metrics |
| **Rooms** | Cold room view with humidity, compressor status, door activity |
| **Map** | Live Leaflet map with truck routes, cold room sites, alert overlays |
| **Alerts** | Real-time alert feed, history with time filter (6h–168h), rules, escalations |
| **Analytics** | SLA compliance, 7-day incident chart (real data), fleet health trends |
| **Settings** | Live pipeline health dots, active threshold profile, display preferences |
| **Simulator** | Admin-only: AI-powered simulator control with scenario library |

### 🤖 AI Agent Features
- **Query Agent** — Natural language queries about fleet status, alerts, temperatures
- **Simulator Agent** — Control simulator via chat ("Open truck03's door for 10 minutes")
- **9 pre-built scenarios** — Temperature excursion, power failure, door malfunction, etc.
- **Floating chat bubble** — Available on every page, no navigation required

### 🔐 Role-Based Access Control
| Role | Access |
|------|--------|
| `admin` | Full access including Simulator page |
| `operator` | Dashboard, Fleet, Rooms, Map, Alerts, Analytics, Settings |

### 📧 SNS Notifications
- Fires email alert on every `NORMAL → CRITICAL` state transition
- Per-asset, real-time — no spam (state must change to trigger)
- IRSA-based AWS credentials (no hardcoded keys)

### 📊 Asset Detail Modal
Click any asset to open a 7-tab detail modal:
1. **Temperature** — Time series chart, min/max/avg
2. **Humidity** — Trend chart
3. **Door Activity** — Open/close events, total duration
4. **Compressor** — Runtime %, cycle count
5. **Location** — GPS route trail on Leaflet map (trucks only)
6. **Alert History** — Severity breakdown, full alert list
7. **Config** — Active threshold profile for this asset

---

## 🛠️ Prerequisites

- AWS CLI configured (`aws configure`)
- Terraform >= 1.5
- kubectl
- Docker Desktop
- Node.js 18+
- Python 3.11+
- An OpenAI-compatible API key (for MCP agent)

---

## 🚀 Quick Start — Full Deploy

### 1. Clone the repo
```bash
git clone https://github.com/Shantanumtk/Digital-Twin-Cold-Chain-mcp.git
cd Digital-Twin-Cold-Chain-mcp
```

### 2. Deploy everything (one command)
```bash
bash scripts/deploy-script.sh \
  --api-key YOUR_OPENAI_API_KEY \
  --profile frozen-logistics
```

This runs 14 steps automatically:
1. Terraform init + apply (VPC, EKS, EC2, SNS)
2. Update kubeconfig
3. Create ECR repos
4. Build + push all Docker images
5. Deploy Kafka + Redis (StatefulSets)
6. Deploy bridge, ingestion, state-engine, dashboard
7. Setup IRSA for SNS
8. Deploy MCP agent on MQTT EC2
9. Start sensor simulator
10. Seed admin + operator users
11. Print dashboard URL

### 3. Access the dashboard
```bash
kubectl get svc -n coldchain dashboard -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Open the URL in your browser.

**Default credentials:**
| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `coldchain2026` |
| Operator | `operator` | `operator123` |

---

## 🔧 Manual Operations

### Check all pods
```bash
kubectl get pods -n coldchain
```

### View state engine logs
```bash
kubectl logs -n coldchain deployment/state-engine -f
```

### View dashboard logs
```bash
kubectl logs -n coldchain deployment/dashboard -f
```

### Trigger fresh SNS alerts (demo)
```bash
kubectl exec -n coldchain deployment/state-engine -- python3 -c \
  "from redis_client import RedisClient; RedisClient().client.flushdb(); print('flushed')"
```

### Rebuild + redeploy dashboard
```bash
STATE_ENGINE=$(kubectl get svc -n coldchain state-engine -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
DASH_LB=$(kubectl get svc -n coldchain dashboard -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL="http://${STATE_ENGINE}" \
  --build-arg MCP_AGENT_URL="http://MQTT_EC2_IP:8001" \
  --build-arg NEXTAUTH_URL="http://${DASH_LB}" \
  --build-arg AUTH_MONGO_URI="mongodb://MONGO_IP:27017" \
  --build-arg NEXTAUTH_SECRET="coldchain-digital-twin-secret-2026" \
  -t dashboard:latest dashboard/ && \
docker tag dashboard:latest ${AWS_ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com/coldchain-digital-twin-dashboard:latest && \
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com && \
docker push ${AWS_ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com/coldchain-digital-twin-dashboard:latest && \
kubectl rollout restart deployment dashboard -n coldchain && \
kubectl rollout status deployment dashboard -n coldchain --timeout=120s
```

### Rebuild + redeploy state engine
```bash
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

docker build --platform linux/amd64 -t state-engine:latest state-engine/ && \
docker tag state-engine:latest ${AWS_ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com/coldchain-digital-twin-state-engine:latest && \
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com && \
docker push ${AWS_ACCOUNT}.dkr.ecr.us-west-2.amazonaws.com/coldchain-digital-twin-state-engine:latest && \
kubectl rollout restart deployment/state-engine -n coldchain && \
kubectl rollout status deployment/state-engine -n coldchain --timeout=120s
```

### Scale state engine
```bash
kubectl scale deployment/state-engine -n coldchain --replicas=2
```

### Check health
```bash
STATE_ENGINE=$(kubectl get svc -n coldchain state-engine -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl http://${STATE_ENGINE}/health | python3 -m json.tool
```

### Seed users manually
```bash
DASH_LB=$(kubectl get svc -n coldchain dashboard -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl http://${DASH_LB}/api/auth/seed
```

### Teardown everything
```bash
bash scripts/destroy-script.sh
```

---

## 📡 State Engine REST API

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Redis, MongoDB, Kafka consumer status |
| `GET /assets` | All assets with current state |
| `GET /assets/{id}` | Single asset state |
| `GET /assets/{id}/telemetry` | Temperature + humidity timeseries |
| `GET /assets/{id}/door-activity` | Door open/close events |
| `GET /assets/{id}/compressor-activity` | Compressor runtime |
| `GET /assets/{id}/location-history` | GPS route trail |
| `GET /assets/{id}/alert-history` | Alert timeline |
| `GET /assets/{id}/summary` | Aggregated stats for modal header |
| `GET /assets/{id}/config` | Active threshold profile |
| `GET /alerts` | Alert history with `?hours=N` filter |
| `GET /alerts/active` | Currently active alerts |
| `GET /stats` | Fleet-wide statistics |
| `GET /profile` | Active threshold profile |
| `POST /profile/reload` | Reload profile from disk |

---

## ⚙️ Threshold Profiles

Profiles are YAML files in `profiles/` that define temperature and humidity thresholds per asset type.

```yaml
# profiles/frozen-logistics.yaml
name: frozen-logistics
fleet:
  trucks: 5
  cold_rooms: 5
thresholds:
  refrigerated_truck:
    frozen_goods:
      temp_warning: -15.0
      temp_critical: -10.0
  cold_room:
    frozen_goods:
      temp_warning: -15.0
      temp_critical: -10.0
```

Switch profiles at deploy time:
```bash
bash scripts/deploy-script.sh --api-key YOUR_KEY --profile pharma
```

---

## 🔔 SNS Email Alerts

Every `NORMAL → CRITICAL` state transition fires an email to the configured address.

Email format:
```
Subject: [CRITICAL] Cold Chain Alert — truck01

CRITICAL ALERT — Cold Chain Digital Twin
─────────────────────────────────────────
Asset     : truck01
Alert Type: STATE_TRANSITION
Message   : Temperature critical: 25.0°C > -10.0°C
Time      : 2026-04-02 04:29:14 UTC
─────────────────────────────────────────
Dashboard : http://your-dashboard-url
```

Configure email in `terraform/sns.tf`:
```hcl
resource "aws_sns_topic_subscription" "email_alert" {
  endpoint = "your-email@example.com"
}
```

---

## 🧠 MCP Agent

The MCP (Model Context Protocol) agent runs on the MQTT EC2 and exposes two agents:

### Query Agent — `POST /api/chat/query`
Natural language queries about fleet status:
- "Which assets are in CRITICAL state?"
- "What's the temperature history for truck03?"
- "How many alerts in the last 24 hours?"

### Simulator Agent — `POST /api/chat/simulate`
Control the simulator via natural language:
- "Open truck03's door"
- "Trigger a compressor failure on site1-room1"
- "Scale fleet to 10 trucks"

---

## 👥 Authors
  
GitHub: [@Shantanumtk](https://github.com/Shantanumtk)

---

## 📚 Course

**CPSC-597** — Graduate Project  
California State University, Fullerton

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.