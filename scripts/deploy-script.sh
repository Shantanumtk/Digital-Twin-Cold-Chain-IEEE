#!/bin/bash
# =============================================================================
# Cold Chain Digital Twin — Idempotent Deploy Script
# =============================================================================
# Every step checks if work is already done before executing.
# Safe to re-run at any point — picks up where it left off.
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
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
PROJECT="coldchain-digital-twin"
NAMESPACE="coldchain"

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

TOTAL_STEPS=13
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

    # Check if deployment already exists
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

  # Only restart if deployment already exists, otherwise just create
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
# Step 13: Print Endpoints & Summary Table
# =============================================================================
print_summary() {
  log_step "Deployment Complete"

  STATE_URL=$(kubectl get svc -n "$NAMESPACE" state-engine \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "pending")
  DASH_URL=$(kubectl get svc -n "$NAMESPACE" dashboard \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "pending")

  track_step "Print Summary" "pass" "All endpoints ready"

  # ── Endpoints ──
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║                        SERVICE ENDPOINTS                            ║${NC}"
  echo -e "${BOLD}╠═══════════════════╦════════════════════════════════════════════════════╣${NC}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "Dashboard" "http://${DASH_URL}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "State Engine API" "http://${STATE_URL}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MQTT Broker" "${MQTT_BROKER_IP}:1883"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MongoDB (private)" "${MONGODB_PRIVATE_IP}:27017"
  echo -e "${BOLD}╚═══════════════════╩════════════════════════════════════════════════════╝${NC}"

  # ── Pod Status ──
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

  # ── Step Summary Table ──
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
  echo "  ║                 on AWS EKS                            ║"
  echo "  ╚═══════════════════════════════════════════════════════╝"
  echo -e "${NC}"

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
  print_summary             # Step 13
}

main "$@"