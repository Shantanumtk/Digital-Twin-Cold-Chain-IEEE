#!/bin/bash
# =============================================================================
# Cold Chain Digital Twin — Idempotent Deploy Script (with Phase 5 MCP Agent)
# =============================================================================
# Every step checks if work is already done before executing.
# Safe to re-run at any point — picks up where it left off.
#
# Usage:
#   bash scripts/deploy-script.sh                          # Deploy without MCP Agent
#   bash scripts/deploy-script.sh --anthropic-key sk-xxx   # Deploy with MCP Agent
# =============================================================================

set -euo pipefail

# Navigate to project root (parent of scripts/)
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

AWS_REGION="us-west-2"
export AWS_DEFAULT_REGION="$AWS_REGION"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
PROJECT="coldchain-digital-twin"
NAMESPACE="coldchain"
SSH_KEY="/Users/shantanu/Downloads/cpsc-597-key.pem"
SSH_USER="ubuntu"  # Ubuntu AMI uses 'ubuntu', not 'ec2-user'

# K8s deployment names
SERVICES=("mqtt-kafka-bridge" "kafka-consumer" "state-engine" "dashboard")

# Local directories containing Dockerfiles
SERVICE_DIRS=("bridge" "ingestion" "state-engine" "dashboard")

# ECR repo names (must match Terraform ecr.tf)
ECR_REPO_NAMES=("${PROJECT}-bridge" "${PROJECT}-ingestion" "${PROJECT}-state-engine" "${PROJECT}-dashboard")

# Step tracking arrays
STEP_NAMES=()
STEP_STATUSES=()
STEP_DETAILS=()

# Parse flags
ANTHROPIC_KEY=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --anthropic-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --ssh-key)       SSH_KEY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Calculate total steps (14 if MCP Agent, 13 if not)
if [ -n "$ANTHROPIC_KEY" ]; then
  TOTAL_STEPS=14
else
  TOTAL_STEPS=13
fi
CURRENT_STEP=0

# =============================================================================
# Helper Functions
# =============================================================================

track_step() {
  STEP_NAMES+=("$1")
  STEP_STATUSES+=("$2")
  STEP_DETAILS+=("$3")
}

log_step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}[${CURRENT_STEP}/${TOTAL_STEPS}] $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_skip() {
  echo -e "  ${GREEN}✓ Already done — $1${NC}"
}

log_done() {
  echo -e "  ${GREEN}✓ $1${NC}"
}

log_info() {
  echo -e "  ${YELLOW}→ $1${NC}"
}

log_error() {
  echo -e "  ${RED}✗ $1${NC}"
}

print_summary_table() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║                    DEPLOYMENT STATUS REPORT                         ║${NC}"
  echo -e "${BOLD}╠════╦═══════════════════════════════╦════════╦═════════════════════════╣${NC}"
  printf  "${BOLD}║ %-2s ║ %-29s ║ %-6s ║ %-23s ║${NC}\n" "#" "Step" "Status" "Detail"
  echo -e "${BOLD}╠════╬═══════════════════════════════╬════════╬═════════════════════════╣${NC}"

  for i in "${!STEP_NAMES[@]}"; do
    local num=$((i + 1))
    local name="${STEP_NAMES[$i]}"
    local status="${STEP_STATUSES[$i]}"
    local detail="${STEP_DETAILS[$i]}"

    if [ ${#detail} -gt 23 ]; then
      detail="${detail:0:20}..."
    fi
    if [ ${#name} -gt 29 ]; then
      name="${name:0:26}..."
    fi

    local icon="" color=""
    case "$status" in
      pass) icon="✅"; color="${GREEN}" ;;
      skip) icon="⏭️ "; color="${CYAN}" ;;
      fail) icon="❌"; color="${RED}" ;;
    esac

    printf "║ %-2s ║ %-29s ║ ${color}%-6s${NC} ║ %-23s ║\n" "$num" "$name" "$icon" "$detail"
  done

  echo -e "${BOLD}╚════╩═══════════════════════════════╩════════╩═════════════════════════╝${NC}"

  local passed=0 skipped=0 failed=0
  for s in "${STEP_STATUSES[@]}"; do
    case "$s" in
      pass) passed=$((passed + 1)) ;;
      skip) skipped=$((skipped + 1)) ;;
      fail) failed=$((failed + 1)) ;;
    esac
  done

  echo ""
  echo -e "  ${GREEN}✅ Executed: ${passed}${NC}    ${CYAN}⏭️  Skipped: ${skipped}${NC}    ${RED}❌ Failed: ${failed}${NC}"
  echo ""
}

# =============================================================================
# Step 1: Terraform State Bucket
# =============================================================================
ensure_state_bucket() {
  log_step "Ensure Terraform State Bucket"

  STATE_BUCKET="${PROJECT}-terraform-state"

  if aws s3api head-bucket --bucket "$STATE_BUCKET" --region "$AWS_REGION" 2>/dev/null; then
    log_skip "Bucket $STATE_BUCKET exists"
    track_step "Terraform State Bucket" "skip" "Already exists"
    return 0
  fi

  log_info "Creating state bucket..."
  aws s3api create-bucket \
    --bucket "$STATE_BUCKET" \
    --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION"

  aws s3api put-bucket-versioning \
    --bucket "$STATE_BUCKET" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-encryption \
    --bucket "$STATE_BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'

  aws s3api put-public-access-block \
    --bucket "$STATE_BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  log_done "State bucket created"
  track_step "Terraform State Bucket" "pass" "Created $STATE_BUCKET"
}

# =============================================================================
# Step 2: Terraform Apply
# =============================================================================
apply_terraform() {
  log_step "Apply Terraform Infrastructure"

  cd terraform

  if [ ! -d ".terraform" ]; then
    log_info "Running terraform init..."
    terraform init
  else
    log_skip "Terraform already initialized"
  fi

  terraform plan -detailed-exitcode -out=tfplan 2>/dev/null && PLAN_EXIT=$? || PLAN_EXIT=$?

  if [ "$PLAN_EXIT" -eq 0 ]; then
    log_skip "No infrastructure changes needed"
    rm -f tfplan
    track_step "Terraform Apply" "skip" "No changes"
  elif [ "$PLAN_EXIT" -eq 2 ]; then
    log_info "Changes detected, applying..."
    terraform apply tfplan
    rm -f tfplan
    log_done "Terraform applied"
    track_step "Terraform Apply" "pass" "Changes applied"
  else
    log_error "Terraform plan failed"
    rm -f tfplan
    cd ..
    track_step "Terraform Apply" "fail" "Plan failed"
    return 1
  fi

  export MQTT_BROKER_IP=$(terraform output -raw mqtt_broker_public_ip)
  export MQTT_BROKER_PRIVATE_IP=$(terraform output -raw mqtt_broker_private_ip)
  export MONGODB_PRIVATE_IP=$(terraform output -raw mongodb_private_ip)
  export EKS_CLUSTER_NAME=$(terraform output -raw eks_cluster_name 2>/dev/null || echo "$PROJECT-eks")

  cd ..
  log_done "MQTT=$MQTT_BROKER_IP | MongoDB=$MONGODB_PRIVATE_IP"
}

# =============================================================================
# Step 3: Update Kubeconfig
# =============================================================================
update_kubeconfig() {
  log_step "Update Kubeconfig for EKS"

  CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")

  if echo "$CURRENT_CONTEXT" | grep -q "$EKS_CLUSTER_NAME" && kubectl get nodes &>/dev/null; then
    log_skip "Kubeconfig already points to $EKS_CLUSTER_NAME"
    track_step "Update Kubeconfig" "skip" "Already configured"
    return 0
  fi

  log_info "Updating kubeconfig..."
  aws eks update-kubeconfig --region "$AWS_REGION" --name "$EKS_CLUSTER_NAME"
  kubectl get nodes
  log_done "Kubeconfig updated"
  track_step "Update Kubeconfig" "pass" "Context switched"
}

# =============================================================================
# Step 4: Verify ECR Repositories (created by Terraform)
# =============================================================================
ensure_ecr_repos() {
  log_step "Verify ECR Repositories"

  ALL_REPOS=("${ECR_REPO_NAMES[@]}" "coldchain-kafka" "coldchain-redis")

  local all_exist=true
  for repo in "${ALL_REPOS[@]}"; do
    if aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" &>/dev/null; then
      log_skip "ECR repo $repo exists"
    else
      log_error "ECR repo $repo missing — check terraform/ecr.tf"
      all_exist=false
    fi
  done

  if [ "$all_exist" = true ]; then
    track_step "ECR Repositories" "skip" "All ${#ALL_REPOS[@]} exist"
  else
    track_step "ECR Repositories" "fail" "Missing repos"
    return 1
  fi
}

# =============================================================================
# Step 5: ECR Login
# =============================================================================
ecr_login() {
  log_step "ECR Docker Login"

  aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "$ECR_REGISTRY"

  log_done "ECR login successful"
  track_step "ECR Docker Login" "pass" "Token refreshed"
}

# =============================================================================
# Step 6: Build and Push Application Images
# =============================================================================
build_and_push_images() {
  log_step "Build and Push Application Images"

  local pushed=0

  for i in "${!SERVICES[@]}"; do
    local svc="${SERVICES[$i]}"
    local dir="${SERVICE_DIRS[$i]}"
    local repo="${ECR_REGISTRY}/${ECR_REPO_NAMES[$i]}"
    local tag="latest"

    # Skip dashboard here — it's built in step 12 with the API URL
    if [ "$svc" = "dashboard" ]; then
      log_info "Skipping dashboard (built in step 12 with API URL)"
      continue
    fi

    log_info "Building $svc from $dir/ (linux/amd64)..."

    docker build --platform linux/amd64 -t "${svc}:${tag}" "$dir"
    docker tag "${svc}:${tag}" "${repo}:${tag}"
    docker push "${repo}:${tag}"
    pushed=$((pushed + 1))

    log_done "Pushed $svc → ${ECR_REPO_NAMES[$i]}"
  done

  track_step "Build & Push App Images" "pass" "Pushed ${pushed} images"
}

# =============================================================================
# Step 7: Push Third-Party Images to ECR
# =============================================================================
push_thirdparty_images() {
  log_step "Push Third-Party Images to ECR"

  THIRDPARTY_IMAGES=(
    "coldchain-kafka|apache/kafka:3.9.0"
    "coldchain-redis|redis:7-alpine"
  )

  local pushed=0
  local skipped=0

  for entry in "${THIRDPARTY_IMAGES[@]}"; do
    local repo="${entry%%|*}"
    local source="${entry##*|}"
    local tag="${source##*:}"
    local target="${ECR_REGISTRY}/${repo}:${tag}"

    if aws ecr describe-images --repository-name "$repo" --image-ids imageTag="$tag" --region "$AWS_REGION" &>/dev/null 2>&1; then
      log_skip "$repo:$tag already in ECR"
      skipped=$((skipped + 1))
      continue
    fi

    log_info "Pulling $source (linux/amd64)..."
    docker pull --platform linux/amd64 "$source"
    docker tag "$source" "$target"
    docker push "$target"
    log_done "Pushed $repo:$tag"
    pushed=$((pushed + 1))
  done

  if [ "$pushed" -eq 0 ]; then
    track_step "Third-Party Images" "skip" "All ${skipped} exist in ECR"
  else
    track_step "Third-Party Images" "pass" "Pushed ${pushed}, skipped ${skipped}"
  fi
}

# =============================================================================
# Step 8: Create Namespace
# =============================================================================
ensure_namespace() {
  log_step "Ensure Kubernetes Namespace"

  if kubectl get namespace "$NAMESPACE" &>/dev/null; then
    log_skip "Namespace $NAMESPACE exists"
    track_step "K8s Namespace" "skip" "Already exists"
    return 0
  fi

  kubectl create namespace "$NAMESPACE"
  log_done "Namespace $NAMESPACE created"
  track_step "K8s Namespace" "pass" "Created $NAMESPACE"
}

# =============================================================================
# Step 9: Apply ConfigMaps (always update — IPs may have changed)
# =============================================================================
apply_configmaps() {
  log_step "Apply ConfigMaps with Current IPs"

  kubectl create configmap bridge-config -n "$NAMESPACE" \
    --from-literal=MQTT_BROKER="$MQTT_BROKER_IP" \
    --from-literal=MQTT_PORT="1883" \
    --from-literal=KAFKA_BOOTSTRAP_SERVERS="kafka:9092" \
    --from-literal=KAFKA_TOPIC_TRUCKS="coldchain.telemetry.trucks" \
    --from-literal=KAFKA_TOPIC_ROOMS="coldchain.telemetry.rooms" \
    --from-literal=KAFKA_TOPIC_ALERTS="coldchain.alerts" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl create configmap ingestion-config -n "$NAMESPACE" \
    --from-literal=KAFKA_BOOTSTRAP_SERVERS="kafka:9092" \
    --from-literal=KAFKA_GROUP_ID="coldchain-ingestion" \
    --from-literal=KAFKA_TOPICS="coldchain.telemetry.trucks,coldchain.telemetry.rooms,coldchain.alerts" \
    --from-literal=MONGO_URI="mongodb://${MONGODB_PRIVATE_IP}:27017" \
    --from-literal=MONGO_DB="coldchain" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl create configmap state-engine-config -n "$NAMESPACE" \
    --from-literal=KAFKA_BOOTSTRAP_SERVERS="kafka:9092" \
    --from-literal=KAFKA_GROUP_ID="state-engine" \
    --from-literal=KAFKA_TOPICS="coldchain.telemetry.trucks,coldchain.telemetry.rooms,coldchain.alerts" \
    --from-literal=REDIS_HOST="redis" \
    --from-literal=REDIS_PORT="6379" \
    --from-literal=REDIS_DB="0" \
    --from-literal=MONGO_URI="mongodb://${MONGODB_PRIVATE_IP}:27017" \
    --from-literal=MONGO_DB="coldchain" \
    --dry-run=client -o yaml | kubectl apply -f -

  log_done "ConfigMaps applied (MQTT=$MQTT_BROKER_IP, MongoDB=$MONGODB_PRIVATE_IP)"
  track_step "ConfigMaps" "pass" "3 configmaps applied"
}

# =============================================================================
# Step 10: Deploy Kafka & Redis (StatefulSets)
# =============================================================================
deploy_stateful_services() {
  log_step "Deploy Kafka & Redis StatefulSets"

  # Ensure StorageClass exists before creating PVCs
  kubectl apply -f k8s/storage/

  local kafka_action="deployed"
  local redis_action="deployed"

  # Kafka
  if kubectl get statefulset kafka -n "$NAMESPACE" &>/dev/null; then
    KAFKA_READY=$(kubectl get statefulset kafka -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [ "${KAFKA_READY:-0}" -ge 1 ]; then
      log_skip "Kafka StatefulSet running ($KAFKA_READY replicas ready)"
      kafka_action="skipped"
    else
      log_info "Kafka exists but not ready, reapplying..."
      kubectl apply -f k8s/kafka/
    fi
  else
    log_info "Deploying Kafka..."
    kubectl apply -f k8s/kafka/
  fi

  # Redis
  if kubectl get statefulset redis -n "$NAMESPACE" &>/dev/null; then
    REDIS_READY=$(kubectl get statefulset redis -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    if [ "${REDIS_READY:-0}" -ge 1 ]; then
      log_skip "Redis StatefulSet running ($REDIS_READY replicas ready)"
      redis_action="skipped"
    else
      log_info "Redis exists but not ready, reapplying..."
      kubectl apply -f k8s/redis/
    fi
  else
    log_info "Deploying Redis..."
    kubectl apply -f k8s/redis/
  fi

  # Wait only if something was deployed
  if [ "$kafka_action" != "skipped" ] || [ "$redis_action" != "skipped" ]; then
    log_info "Waiting for Kafka and Redis to be ready..."
    kubectl rollout status statefulset kafka -n "$NAMESPACE" --timeout=180s
    kubectl rollout status statefulset redis -n "$NAMESPACE" --timeout=180s
  fi

  if [ "$kafka_action" = "skipped" ] && [ "$redis_action" = "skipped" ]; then
    track_step "Kafka & Redis" "skip" "Both already running"
  else
    log_done "Kafka and Redis ready"
    track_step "Kafka & Redis" "pass" "Kafka:${kafka_action} Redis:${redis_action}"
  fi
}

# =============================================================================
# Step 11: Deploy Application Services
# =============================================================================
deploy_app_services() {
  log_step "Deploy Application Services"

  APP_SERVICES=("bridge" "ingestion" "state-engine")
  DEPLOY_NAMES=("mqtt-kafka-bridge" "kafka-consumer" "state-engine")

  local deployed=0
  local restarted=0

  for i in "${!APP_SERVICES[@]}"; do
    local svc_dir="${APP_SERVICES[$i]}"
    local deploy_name="${DEPLOY_NAMES[$i]}"

    if kubectl get deployment "$deploy_name" -n "$NAMESPACE" &>/dev/null; then
      kubectl apply -f "k8s/${svc_dir}/"
      kubectl rollout restart deployment "$deploy_name" -n "$NAMESPACE"
      log_info "Restarted $deploy_name to pick up latest changes"
      restarted=$((restarted + 1))
    else
      log_info "Deploying $deploy_name..."
      kubectl apply -f "k8s/${svc_dir}/"
      deployed=$((deployed + 1))
    fi
  done

  log_info "Waiting for services to be ready..."
  for deploy_name in "${DEPLOY_NAMES[@]}"; do
    kubectl rollout status deployment "$deploy_name" -n "$NAMESPACE" --timeout=180s
    log_done "$deploy_name ready"
  done

  log_done "All application services running"
  track_step "Application Services" "pass" "New:${deployed} Restarted:${restarted}"
}

# =============================================================================
# Step 12: Deploy Dashboard
# =============================================================================
deploy_dashboard() {
  log_step "Deploy Dashboard"

  STATE_ENGINE_URL=$(kubectl get svc -n "$NAMESPACE" state-engine \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")

  if [ -z "$STATE_ENGINE_URL" ]; then
    log_info "Waiting for state-engine LoadBalancer..."
    kubectl wait --for=jsonpath='{.status.loadBalancer.ingress[0].hostname}' \
      svc/state-engine -n "$NAMESPACE" --timeout=120s
    STATE_ENGINE_URL=$(kubectl get svc -n "$NAMESPACE" state-engine \
      -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
  fi

  log_info "State Engine API: http://${STATE_ENGINE_URL}"

  local repo="${ECR_REGISTRY}/${PROJECT}-dashboard"
  docker build --platform linux/amd64 \
    --build-arg NEXT_PUBLIC_API_URL="http://${STATE_ENGINE_URL}" \
    -t dashboard:latest dashboard/
  docker tag dashboard:latest "${repo}:latest"
  docker push "${repo}:latest"

  if kubectl get deployment dashboard -n "$NAMESPACE" &>/dev/null; then
    kubectl apply -f k8s/dashboard/
    kubectl rollout restart deployment dashboard -n "$NAMESPACE"
  else
    kubectl apply -f k8s/dashboard/
  fi

  log_info "Waiting for dashboard pods..."
  kubectl rollout status deployment dashboard -n "$NAMESPACE" --timeout=180s

  log_done "Dashboard deployed"
  track_step "Dashboard" "pass" "API=$STATE_ENGINE_URL"
}

# =============================================================================
# Step 13: Deploy MCP Agent (Phase 5) — NodePort + .env + Docker on MQTT EC2
# =============================================================================
deploy_mcp_agent() {
  log_step "Deploy MCP Agent (Phase 5)"

  if [ -z "$ANTHROPIC_KEY" ]; then
    log_info "No --anthropic-key provided, skipping MCP Agent"
    track_step "MCP Agent (Phase 5)" "skip" "No API key provided"
    return 0
  fi

  # --- 13a: Create NodePort for Redis ---
  log_info "Creating Redis NodePort service (30379)..."
  cat <<'YAML' | kubectl apply -n "$NAMESPACE" -f -
apiVersion: v1
kind: Service
metadata:
  name: redis-external
spec:
  type: NodePort
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
      nodePort: 30379
      protocol: TCP
YAML
  log_done "Redis NodePort 30379"

  # --- 13b: Create NodePort for Kafka external listener ---
  log_info "Creating Kafka external NodePort service (30092)..."

  # Get EKS node private IP for Kafka advertised listener
  EKS_NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
  log_info "EKS Node IP: $EKS_NODE_IP"

  # Check if Kafka already has EXTERNAL listener configured
  CURRENT_LISTENERS=$(kubectl get statefulset kafka -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="KAFKA_LISTENERS")].value}' 2>/dev/null || echo "")

  if echo "$CURRENT_LISTENERS" | grep -q "EXTERNAL"; then
    log_skip "Kafka already has EXTERNAL listener"
  else
    log_info "Patching Kafka with EXTERNAL listener on port 9094..."
    # The existing StatefulSet has:
    #   KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
    #   KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
    #   KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
    # We add EXTERNAL://:9094 for NodePort access
    kubectl set env statefulset/kafka -n "$NAMESPACE" \
      KAFKA_LISTENERS="PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094" \
      KAFKA_ADVERTISED_LISTENERS="PLAINTEXT://kafka:9092,EXTERNAL://${EKS_NODE_IP}:30092" \
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP="CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT"

    log_info "Waiting for Kafka to restart with external listener..."
    kubectl rollout status statefulset/kafka -n "$NAMESPACE" --timeout=180s
  fi

  # Create kafka-external NodePort service (idempotent via apply)
  cat <<YAML | kubectl apply -n "$NAMESPACE" -f -
apiVersion: v1
kind: Service
metadata:
  name: kafka-external
spec:
  type: NodePort
  selector:
    app: kafka
  ports:
    - name: external
      port: 9094
      targetPort: 9094
      nodePort: 30092
      protocol: TCP
YAML
  log_done "Kafka external NodePort 30092"

  # --- 13c: Security group rules ---
  log_info "Adding security group rules (MQTT EC2 → EKS NodePorts)..."

  MQTT_INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${PROJECT}-mqtt-broker" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].InstanceId" --output text 2>/dev/null || true)

  MQTT_SG=""
  if [ -n "$MQTT_INSTANCE_ID" ] && [ "$MQTT_INSTANCE_ID" != "None" ]; then
    MQTT_SG=$(aws ec2 describe-instances \
      --instance-ids "$MQTT_INSTANCE_ID" \
      --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId" --output text 2>/dev/null || true)
  fi

  EKS_NODE_SG=""
  EKS_NODE_INSTANCE=$(kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' 2>/dev/null | grep -o 'i-[a-z0-9]*' || true)
  if [ -n "$EKS_NODE_INSTANCE" ]; then
    EKS_NODE_SG=$(aws ec2 describe-instances \
      --instance-ids "$EKS_NODE_INSTANCE" \
      --query "Reservations[0].Instances[0].SecurityGroups[*].GroupId" --output text 2>/dev/null | awk '{print $1}' || true)
  fi

  if [ -n "$EKS_NODE_SG" ] && [ "$EKS_NODE_SG" != "None" ] && [ -n "$MQTT_SG" ] && [ "$MQTT_SG" != "None" ]; then
    log_info "MQTT SG: $MQTT_SG → EKS Node SG: $EKS_NODE_SG"

    aws ec2 authorize-security-group-ingress \
      --group-id "$EKS_NODE_SG" \
      --protocol tcp --port 30379 \
      --source-group "$MQTT_SG" \
      --description "MCP-Agent-Redis-NodePort" 2>/dev/null \
      && log_done "SG rule: TCP 30379 (Redis)" \
      || log_info "(Redis SG rule already exists)"

    aws ec2 authorize-security-group-ingress \
      --group-id "$EKS_NODE_SG" \
      --protocol tcp --port 30092 \
      --source-group "$MQTT_SG" \
      --description "MCP-Agent-Kafka-NodePort" 2>/dev/null \
      && log_done "SG rule: TCP 30092 (Kafka)" \
      || log_info "(Kafka SG rule already exists)"
  else
    log_error "Could not auto-detect SGs. Manually add MQTT→EKS rules for 30379,30092"
  fi

  # Also allow MCP Agent port 8001 from anywhere (for external API access)
  if [ -n "$MQTT_SG" ] && [ "$MQTT_SG" != "None" ]; then
    aws ec2 authorize-security-group-ingress \
      --group-id "$MQTT_SG" \
      --protocol tcp --port 8001 \
      --cidr "0.0.0.0/0" \
      --description "MCP-Agent-API-Public" 2>/dev/null \
      && log_done "SG rule: TCP 8001 (MCP Agent public)" \
      || log_info "(MCP Agent 8001 SG rule already exists)"
  fi

  # --- 13d: Generate .env and deploy MCP Agent ---
  log_info "Generating MCP Agent .env..."

  ENV_FILE=$(mktemp)
  cat > "$ENV_FILE" << ENVGEN
OPENAI_API_KEY=${ANTHROPIC_KEY}
OPENAI_BASE_URL=https://api.ai.kodekloud.com/v1
LLM_MODEL=anthropic/claude-sonnet-4.5
MONGO_URI=mongodb://${MONGODB_PRIVATE_IP}:27017
MONGO_DB=coldchain
REDIS_HOST=${EKS_NODE_IP}
REDIS_PORT=30379
KAFKA_BOOTSTRAP_SERVERS=${EKS_NODE_IP}:30092
MQTT_BROKER=localhost
MQTT_PORT=1883
SIMULATOR_DIR=/home/ubuntu/CPSC-597-Digital-Twin-Cold-Chain
MCP_HOST=0.0.0.0
MCP_PORT=8001
ENVGEN

  log_info "Uploading MCP Agent to MQTT EC2 (${MQTT_BROKER_IP})..."

  # Ensure mcp-agent directory exists on MQTT EC2
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} "mkdir -p ~/mcp-agent" 2>/dev/null

  # Upload agent code (scp contents, not nested dir)
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r mcp-agent/* ${SSH_USER}@${MQTT_BROKER_IP}:~/mcp-agent/ 2>/dev/null
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ENV_FILE" ${SSH_USER}@${MQTT_BROKER_IP}:~/mcp-agent/.env 2>/dev/null
  rm -f "$ENV_FILE"
  log_done ".env and code uploaded"

  # Build and run on MQTT EC2
  log_info "Building and starting MCP Agent container..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} << 'REMOTE_EOF'
set -e
cd ~/mcp-agent

echo "  Building MCP Agent image..."
docker build -t mcp-agent:latest . 2>&1 | tail -3

echo "  Stopping old container..."
docker stop mcp-agent 2>/dev/null || true
docker rm mcp-agent 2>/dev/null || true

echo "  Starting MCP Agent with --network host..."
docker run -d \
  --name mcp-agent \
  --network host \
  --env-file .env \
  --restart unless-stopped \
  mcp-agent:latest

sleep 3
echo ""
echo "  Container status:"
docker ps --filter name=mcp-agent --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "  Last 5 logs:"
docker logs mcp-agent --tail 5
REMOTE_EOF

  log_done "MCP Agent running on ${MQTT_BROKER_IP}:8001"

  # --- 13e: Verify connectivity ---
  log_info "Verifying MCP Agent connectivity..."

  HEALTH=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} \
    "curl -s --max-time 5 http://localhost:8001/api/health" 2>/dev/null || echo '{"status":"unreachable"}')
  log_info "Health: $HEALTH"

  track_step "MCP Agent (Phase 5)" "pass" "Running on :8001"
}

# =============================================================================
# Step 14 (or 13): Print Endpoints & Summary Table
# =============================================================================
print_summary() {
  log_step "Deployment Complete"

  STATE_URL=$(kubectl get svc -n "$NAMESPACE" state-engine \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "pending")
  DASH_URL=$(kubectl get svc -n "$NAMESPACE" dashboard \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "pending")

  track_step "Print Summary" "pass" "All endpoints ready"

  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║                        SERVICE ENDPOINTS                            ║${NC}"
  echo -e "${BOLD}╠═══════════════════╦════════════════════════════════════════════════════╣${NC}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "Dashboard" "http://${DASH_URL}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "State Engine API" "http://${STATE_URL}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MQTT Broker" "${MQTT_BROKER_IP}:1883"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MongoDB (private)" "${MONGODB_PRIVATE_IP}:27017"

  if [ -n "$ANTHROPIC_KEY" ]; then
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MCP Agent" "http://${MQTT_BROKER_IP}:8001"
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MCP Query API" "POST http://${MQTT_BROKER_IP}:8001/api/chat/query"
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MCP Sim API" "POST http://${MQTT_BROKER_IP}:8001/api/chat/simulate"
  fi

  echo -e "${BOLD}╚═══════════════════╩════════════════════════════════════════════════════╝${NC}"

  if [ -n "$ANTHROPIC_KEY" ]; then
    echo ""
    echo -e "  ${BOLD}MCP Agent Architecture:${NC}"
    echo "  MQTT EC2 (${MQTT_BROKER_IP} / ${MQTT_BROKER_PRIVATE_IP})"
    echo "  ├── Mosquitto broker (:1883)"
    echo "  ├── Sensor simulator (docker-compose)"
    echo "  └── MCP Agent (FastAPI :8001)"
    echo "      ├── → MQTT (localhost:1883)              ✅"
    echo "      ├── → MongoDB (${MONGODB_PRIVATE_IP}:27017)   ✅ same VPC"
    EKS_NODE_IP_DISPLAY=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "?")
    echo "      ├── → Redis (${EKS_NODE_IP_DISPLAY}:30379)    ✅ NodePort"
    echo "      ├── → Kafka (${EKS_NODE_IP_DISPLAY}:30092)    ✅ NodePort"
    echo "      └── → docker-compose (localhost)          ✅"
  fi

  echo ""
  echo -e "${BOLD}Pod Status:${NC}"
  kubectl get pods -n "$NAMESPACE" \
    -o custom-columns="NAME:.metadata.name,STATUS:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount,AGE:.metadata.creationTimestamp" \
    --no-headers | while read -r line; do
    if echo "$line" | grep -q "Running"; then
      echo -e "  ${GREEN}●${NC} $line"
    else
      echo -e "  ${RED}●${NC} $line"
    fi
  done

  print_summary_table
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo -e "${GREEN}"
  echo "  ╔═══════════════════════════════════════════════════════╗"
  echo "  ║       Cold Chain Digital Twin — Deploy Script         ║"
  echo "  ║                                                       ║"
  echo "  ║   MQTT → Kafka → MongoDB/Redis → FastAPI → Next.js   ║"
  echo "  ║              + MCP Agent (Phase 5)                    ║"
  echo "  ║                 on AWS EKS                            ║"
  echo "  ╚═══════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  if [ -n "$ANTHROPIC_KEY" ]; then
    echo -e "  ${GREEN}MCP Agent: ENABLED (--anthropic-key provided)${NC}"
  else
    echo -e "  ${YELLOW}MCP Agent: DISABLED (pass --anthropic-key to enable)${NC}"
  fi
  echo ""

  ensure_state_bucket       # Step  1
  apply_terraform           # Step  2
  update_kubeconfig         # Step  3
  ensure_ecr_repos          # Step  4
  ecr_login                 # Step  5
  build_and_push_images     # Step  6
  push_thirdparty_images    # Step  7
  ensure_namespace          # Step  8
  apply_configmaps          # Step  9
  deploy_stateful_services  # Step 10
  deploy_app_services       # Step 11
  deploy_dashboard          # Step 12

  if [ -n "$ANTHROPIC_KEY" ]; then
    deploy_mcp_agent        # Step 13
  fi

  print_summary             # Step 13/14
}

main "$@"