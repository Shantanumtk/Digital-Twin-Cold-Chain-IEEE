#!/bin/bash
# =============================================================================
# Cold Chain Digital Twin — Idempotent Deploy Script (with Phase 5 MCP Agent)
# =============================================================================
# Every step checks if work is already done before executing.
# Safe to re-run at any point — picks up where it left off.
#
# Usage:
#   bash scripts/deploy-script.sh                          # Deploy without MCP Agent
#   bash scripts/deploy-script.sh --api-key sk-xxx         # Deploy with MCP Agent
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
SSH_USER="ubuntu"

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
API_KEY=""
PROFILE_NAME="default"
while [[ $# -gt 0 ]]; do
  case $1 in
    --api-key) API_KEY="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --profile) PROFILE_NAME="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Calculate total steps
if [ -n "$API_KEY" ]; then
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

log_skip()  { echo -e "  ${GREEN}✓ Already done — $1${NC}"; }
log_done()  { echo -e "  ${GREEN}✓ $1${NC}"; }
log_info()  { echo -e "  ${YELLOW}→ $1${NC}"; }
log_error() { echo -e "  ${RED}✗ $1${NC}"; }

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
    if [ ${#detail} -gt 23 ]; then detail="${detail:0:20}..."; fi
    if [ ${#name}  -gt 29 ]; then name="${name:0:26}..."; fi
    local icon="" color=""
    case "$status" in
      pass) icon="✅"; color="${GREEN}" ;;
      skip) icon="⏭️ "; color="${CYAN}"  ;;
      fail) icon="❌"; color="${RED}"   ;;
    esac
    printf "║ %-2s ║ %-29s ║ ${color}%-6s${NC} ║ %-23s ║\n" \
      "$num" "$name" "$icon" "$detail"
  done

  echo -e "${BOLD}╚════╩═══════════════════════════════╩════════╩═════════════════════════╝${NC}"

  local passed=0 skipped=0 failed=0
  for s in "${STEP_STATUSES[@]}"; do
    case "$s" in
      pass) passed=$((passed + 1))   ;;
      skip) skipped=$((skipped + 1)) ;;
      fail) failed=$((failed + 1))   ;;
    esac
  done

  echo ""
  echo -e "  ${GREEN}✅ Executed: ${passed}${NC}    ${CYAN}⏭️  Skipped: ${skipped}${NC}    ${RED}❌ Failed: ${failed}${NC}"
  echo ""
}

# =============================================================================
# HELPER: Find which EKS node a pod is running on
# =============================================================================
get_eks_node_ip_for_pod() {
  # Returns the private IP of the EKS node running the matched pod.
  # kubectl get pod -o wide column 7 is the NODE NAME (hostname), not IP.
  # We resolve the node name -> InternalIP via a separate kubectl get node call.
  local pattern="$1"
  local ns="${2:-$NAMESPACE}"

  # Step 1: get the node NAME from the pod listing
  local node_name
  node_name=$(kubectl get pod -n "$ns" -o wide 2>/dev/null \
    | grep "$pattern" \
    | awk '{print $7}' \
    | head -1)

  if [ -z "$node_name" ] || [ "$node_name" = "<none>" ]; then
    echo ""
    return 0
  fi

  # Step 2: resolve node name -> InternalIP
  kubectl get node "$node_name" \
    -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null \
    || echo ""
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
# Step 4: Verify ECR Repositories
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

    if aws ecr describe-images --repository-name "$repo" \
        --image-ids imageTag="$tag" --region "$AWS_REGION" &>/dev/null 2>&1; then
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
# Step 9: IRSA for SNS
# =============================================================================
setup_irsa_sns() {
  log_step "Setup IRSA for State Engine SNS"

  local SA_NAME="state-engine-sa"
  local ROLE_NAME="coldchain-state-engine-sns-role"
  local POLICY_NAME="coldchain-sns-publish"
  local OIDC_ID
  OIDC_ID=$(aws eks describe-cluster --name "$EKS_CLUSTER_NAME" --region "$AWS_REGION" \
    --query "cluster.identity.oidc.issuer" --output text | sed 's|.*/||')
  local OIDC_PROVIDER="oidc.eks.${AWS_REGION}.amazonaws.com/id/${OIDC_ID}"
  local POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}"

  cat > /tmp/trust-policy.json << TRUST
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER}:sub": "system:serviceaccount:${NAMESPACE}:${SA_NAME}",
          "${OIDC_PROVIDER}:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
TRUST

  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document file:///tmp/trust-policy.json \
    --region "$AWS_REGION" 2>/dev/null || true
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document file:///tmp/trust-policy.json
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "$POLICY_ARN" 2>/dev/null || true

  kubectl apply -f - << YAML
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}
YAML

  local SNS_ARN="arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:coldchain-critical-alerts"
  kubectl set env deployment/state-engine -n "$NAMESPACE" \
    SNS_TOPIC_ARN="$SNS_ARN" 2>/dev/null || true

  log_done "IRSA setup complete"
  track_step "IRSA SNS" "pass" "ServiceAccount + IAM role"
}

# =============================================================================
# Step 10: Apply ConfigMaps
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
    --from-literal=SNS_TOPIC_ARN="arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:coldchain-critical-alerts" \
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
    --from-literal=SNS_TOPIC_ARN="arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:coldchain-critical-alerts" \
    --dry-run=client -o yaml | kubectl apply -f -

  PROFILE_FILE="profiles/${PROFILE_NAME}.yaml"
  if [ -f "$PROFILE_FILE" ]; then
    kubectl create configmap profile-config -n "$NAMESPACE" \
      --from-file=active.yaml="$PROFILE_FILE" \
      --dry-run=client -o yaml | kubectl apply -f -
    log_done "Profile ConfigMap created from $PROFILE_FILE"
  else
    log_error "Profile file not found: $PROFILE_FILE"
  fi

  log_done "ConfigMaps applied (MQTT=$MQTT_BROKER_IP, MongoDB=$MONGODB_PRIVATE_IP)"
  track_step "ConfigMaps" "pass" "3 configmaps applied"
}

# =============================================================================
# Step 10b: Deploy Kafka & Redis (StatefulSets)
# =============================================================================
deploy_stateful_services() {
  log_step "Deploy Kafka & Redis StatefulSets"

  kubectl apply -f k8s/storage/

  local kafka_action="deployed"
  local redis_action="deployed"

  if kubectl get statefulset kafka -n "$NAMESPACE" &>/dev/null; then
    KAFKA_READY=$(kubectl get statefulset kafka -n "$NAMESPACE" \
      -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
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

  if kubectl get statefulset redis -n "$NAMESPACE" &>/dev/null; then
    REDIS_READY=$(kubectl get statefulset redis -n "$NAMESPACE" \
      -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
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
    local svc_dir="${DEPLOY_NAMES[$i]}"
    local deploy_name="${DEPLOY_NAMES[$i]}"

    if kubectl get deployment "$deploy_name" -n "$NAMESPACE" &>/dev/null; then
      kubectl apply -f "k8s/${APP_SERVICES[$i]}/"
      kubectl rollout restart deployment "$deploy_name" -n "$NAMESPACE"
      log_info "Restarted $deploy_name"
      restarted=$((restarted + 1))
    else
      log_info "Deploying $deploy_name..."
      kubectl apply -f "k8s/${APP_SERVICES[$i]}/"
      deployed=$((deployed + 1))
    fi
  done

  kubectl patch deployment state-engine -n "$NAMESPACE" --type=json -p='[
    {"op":"add","path":"/spec/template/spec/volumes","value":[{"name":"profile","configMap":{"name":"profile-config"}}]},
    {"op":"add","path":"/spec/template/spec/containers/0/volumeMounts","value":[{"name":"profile","mountPath":"/app/config","readOnly":true}]}
  ]' 2>/dev/null || log_info "Profile volume already mounted on state-engine"

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
    --build-arg MCP_AGENT_URL="http://${MQTT_BROKER_PRIVATE_IP}:8001" \
    --build-arg AUTH_MONGO_URI="mongodb://${MONGODB_PRIVATE_IP}:27017" \
    --build-arg NEXTAUTH_SECRET="coldchain-digital-twin-secret-2026" \
    -t dashboard:latest dashboard/
  docker tag dashboard:latest "${repo}:latest"
  docker push "${repo}:latest"

  if kubectl get deployment dashboard -n "$NAMESPACE" &>/dev/null; then
    kubectl apply -f k8s/dashboard/
    kubectl rollout restart deployment dashboard -n "$NAMESPACE"
  else
    kubectl apply -f k8s/dashboard/
  fi

  if [ -n "$API_KEY" ]; then
    kubectl set env deployment/dashboard -n "$NAMESPACE" \
      MCP_AGENT_URL="http://${MQTT_BROKER_PRIVATE_IP}:8001"
    log_done "MCP Agent URL set to http://${MQTT_BROKER_PRIVATE_IP}:8001"
  fi

  DASH_LB_URL=$(kubectl get svc -n "$NAMESPACE" dashboard \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
  if [ -z "$DASH_LB_URL" ]; then
    log_info "Waiting for dashboard LoadBalancer..."
    kubectl wait --for=jsonpath='{.status.loadBalancer.ingress[0].hostname}' \
      svc/dashboard -n "$NAMESPACE" --timeout=120s 2>/dev/null || true
    DASH_LB_URL=$(kubectl get svc -n "$NAMESPACE" dashboard \
      -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "localhost:3000")
  fi

  kubectl set env deployment/dashboard -n "$NAMESPACE" \
    AUTH_MONGO_URI="mongodb://${MONGODB_PRIVATE_IP}:27017" \
    NEXTAUTH_SECRET="coldchain-digital-twin-secret-2026" \
    NEXTAUTH_URL="http://${DASH_LB_URL}"
  log_done "NEXTAUTH_URL set to http://${DASH_LB_URL}"

  log_info "Waiting for dashboard pods..."
  kubectl rollout status deployment dashboard -n "$NAMESPACE" --timeout=180s

  log_done "Dashboard deployed"
  track_step "Dashboard" "pass" "API=$STATE_ENGINE_URL"
}

# =============================================================================
# Step 13: Deploy MCP Agent
# =============================================================================
deploy_mcp_agent() {
  log_step "Deploy MCP Agent (Phase 5)"

  if [ -z "$API_KEY" ]; then
    log_info "No --api-key provided, skipping MCP Agent"
    track_step "MCP Agent (Phase 5)" "skip" "No API key provided"
    return 0
  fi

  # ── 13a: NodePort for Redis ────────────────────────────────────────────────
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

  # ── 13b: NodePort + EXTERNAL listener for Kafka ───────────────────────────
  log_info "Creating Kafka external NodePort service (30092)..."

  KAFKA_NODE_IP=$(get_eks_node_ip_for_pod "kafka-0")
  if [ -z "$KAFKA_NODE_IP" ]; then
    KAFKA_NODE_IP=$(kubectl get nodes \
      -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
  fi
  log_info "Kafka node IP: $KAFKA_NODE_IP"

  CURRENT_LISTENERS=$(kubectl get statefulset kafka -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="KAFKA_LISTENERS")].value}' \
    2>/dev/null || echo "")

  if echo "$CURRENT_LISTENERS" | grep -q "EXTERNAL"; then
    log_skip "Kafka already has EXTERNAL listener"
  else
    log_info "Patching Kafka with EXTERNAL listener on port 9094..."
    kubectl set env statefulset/kafka -n "$NAMESPACE" \
      KAFKA_LISTENERS="PLAINTEXT://:9092,CONTROLLER://:9093,EXTERNAL://:9094" \
      KAFKA_ADVERTISED_LISTENERS="PLAINTEXT://kafka:9092,EXTERNAL://${KAFKA_NODE_IP}:30092" \
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP="CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,EXTERNAL:PLAINTEXT"
    log_info "Waiting for Kafka to restart with external listener..."
    kubectl rollout status statefulset/kafka -n "$NAMESPACE" --timeout=180s
  fi

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

  # ── 13c: Security group rules ─────────────────────────────────────────────
  log_info "Adding security group rules (MQTT EC2 → EKS NodePorts)..."

  MQTT_INSTANCE_ID=$(aws ec2 describe-instances \
    --filters \
      "Name=tag:Name,Values=${PROJECT}-mqtt-broker" \
      "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text 2>/dev/null || true)

  MQTT_SG=""
  MQTT_PRIVATE_IP="$MQTT_BROKER_PRIVATE_IP"
  if [ -n "$MQTT_INSTANCE_ID" ] && [ "$MQTT_INSTANCE_ID" != "None" ]; then
    MQTT_SG=$(aws ec2 describe-instances \
      --instance-ids "$MQTT_INSTANCE_ID" \
      --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId" \
      --output text 2>/dev/null || true)
    MQTT_PRIVATE_IP=$(aws ec2 describe-instances \
      --instance-ids "$MQTT_INSTANCE_ID" \
      --query "Reservations[0].Instances[0].PrivateIpAddress" \
      --output text 2>/dev/null || echo "$MQTT_BROKER_PRIVATE_IP")
  fi

  REDIS_NODE_IP=$(get_eks_node_ip_for_pod "redis-0")
  EKS_NODE_SG=""
  if [ -n "$REDIS_NODE_IP" ]; then
    EKS_NODE_INSTANCE=$(aws ec2 describe-instances \
      --filters "Name=private-ip-address,Values=${REDIS_NODE_IP}" \
      --query "Reservations[0].Instances[0].InstanceId" \
      --output text 2>/dev/null || true)
    if [ -n "$EKS_NODE_INSTANCE" ] && [ "$EKS_NODE_INSTANCE" != "None" ]; then
      EKS_NODE_SG=$(aws ec2 describe-instances \
        --instance-ids "$EKS_NODE_INSTANCE" \
        --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId" \
        --output text 2>/dev/null || true)
    fi
  fi

  if [ -n "$EKS_NODE_SG" ] && [ "$EKS_NODE_SG" != "None" ]; then
    log_info "EKS Node SG: $EKS_NODE_SG"

    aws ec2 authorize-security-group-ingress \
      --group-id "$EKS_NODE_SG" \
      --protocol tcp --port 30379 \
      --cidr "${MQTT_PRIVATE_IP}/32" \
      --description "MCP-Agent-Redis-NodePort" 2>/dev/null \
      && log_done "SG rule: TCP 30379 (Redis)" \
      || log_info "(Redis SG rule already exists)"

    aws ec2 authorize-security-group-ingress \
      --group-id "$EKS_NODE_SG" \
      --protocol tcp --port 30092 \
      --cidr "${MQTT_PRIVATE_IP}/32" \
      --description "MCP-Agent-Kafka-NodePort" 2>/dev/null \
      && log_done "SG rule: TCP 30092 (Kafka)" \
      || log_info "(Kafka SG rule already exists)"
  else
    log_error "Could not auto-detect EKS node SG. NodePorts may be blocked."
  fi

  if [ -n "$MQTT_SG" ] && [ "$MQTT_SG" != "None" ]; then
    aws ec2 authorize-security-group-ingress \
      --group-id "$MQTT_SG" \
      --protocol tcp --port 8001 \
      --cidr "0.0.0.0/0" \
      --description "MCP-Agent-API-Public" 2>/dev/null \
      && log_done "SG rule: TCP 8001 (MCP Agent public)" \
      || log_info "(MCP Agent 8001 SG rule already exists)"
  fi

  # ── 13d: Resolve node IPs for env file ────────────────────────────────────
  REDIS_NODE_IP=$(get_eks_node_ip_for_pod "redis-0")
  KAFKA_NODE_IP=$(get_eks_node_ip_for_pod "kafka-0")

  if [ -z "$REDIS_NODE_IP" ]; then
    REDIS_NODE_IP=$(kubectl get nodes \
      -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    log_info "Fallback: using first node IP for Redis: $REDIS_NODE_IP"
  fi
  if [ -z "$KAFKA_NODE_IP" ]; then
    KAFKA_NODE_IP=$(kubectl get nodes \
      -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    log_info "Fallback: using first node IP for Kafka: $KAFKA_NODE_IP"
  fi

  log_info "Redis node: $REDIS_NODE_IP | Kafka node: $KAFKA_NODE_IP"

  # ── 13e: Upload MCP Agent code ────────────────────────────────────────────
  log_info "Uploading MCP Agent code to MQTT EC2 (${MQTT_BROKER_IP})..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} \
    "mkdir -p ~/mcp-agent ~/CPSC-597-Digital-Twin-Cold-Chain/profiles" 2>/dev/null

  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r mcp-agent/* \
    ${SSH_USER}@${MQTT_BROKER_IP}:~/mcp-agent/ 2>/dev/null
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r profiles/* \
    ${SSH_USER}@${MQTT_BROKER_IP}:~/CPSC-597-Digital-Twin-Cold-Chain/profiles/ 2>/dev/null
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "profiles/${PROFILE_NAME}.yaml" \
    ${SSH_USER}@${MQTT_BROKER_IP}:~/CPSC-597-Digital-Twin-Cold-Chain/profiles/active.yaml 2>/dev/null
  log_done "Code and profiles uploaded"

  # ── 13f: Write /etc/mcp-agent.env ─────────────────────────────────────────
  # FIX: chmod 644 (not 600) so the ubuntu user / docker can read it
  log_info "Writing persistent env file /etc/mcp-agent.env..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} \
    "sudo tee /etc/mcp-agent.env > /dev/null << 'ENVEOF'
OPENAI_API_KEY=${API_KEY}
OPENAI_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
REDIS_HOST=${REDIS_NODE_IP}
REDIS_PORT=30379
KAFKA_BOOTSTRAP_SERVERS=${KAFKA_NODE_IP}:30092
MONGO_URI=mongodb://${MONGODB_PRIVATE_IP}:27017
MONGO_DB=coldchain
MQTT_BROKER=localhost
MQTT_PORT=1883
MCP_HOST=0.0.0.0
MCP_PORT=8001
ENVEOF
sudo chmod 644 /etc/mcp-agent.env
sudo chown root:root /etc/mcp-agent.env
echo 'Wrote /etc/mcp-agent.env'"
  log_done "/etc/mcp-agent.env written (chmod 644 — readable by docker)"

  # ── 13g: Install restart-mcp-agent ────────────────────────────────────────
  # FIX: all docker commands use sudo so ubuntu user can run them without
  # needing to be in the docker group, and --env-file reads the 644 file
  log_info "Installing restart-mcp-agent command..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} \
    "sudo tee /usr/local/bin/restart-mcp-agent > /dev/null << 'SCRIPTEOF'
#!/bin/bash
set -e
echo \"Restarting mcp-agent...\"
sudo docker stop mcp-agent 2>/dev/null || true
sudo docker rm   mcp-agent 2>/dev/null || true
sudo docker run -d \
  --name mcp-agent \
  --network host \
  --restart unless-stopped \
  --env-file /etc/mcp-agent.env \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /home/ubuntu/CPSC-597-Digital-Twin-Cold-Chain:/home/ubuntu/CPSC-597-Digital-Twin-Cold-Chain:ro \
  mcp-agent:latest
echo 'mcp-agent started'
sudo sudo docker ps --filter name=mcp-agent --format 'table {{.Names}}\t{{.Status}}'
SCRIPTEOF
sudo chmod +x /usr/local/bin/restart-mcp-agent
echo 'Installed restart-mcp-agent'"
  log_done "/usr/local/bin/restart-mcp-agent installed"

  # ── 13h: Install systemd service ──────────────────────────────────────────
  log_info "Installing systemd service (auto-start on reboot)..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} \
    "sudo tee /etc/systemd/system/mcp-agent.service > /dev/null << 'SVCEOF'
[Unit]
Description=Cold Chain MCP Agent (LangGraph)
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/restart-mcp-agent
ExecStop=/usr/bin/docker stop mcp-agent
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
SVCEOF
sudo systemctl daemon-reload
sudo systemctl enable mcp-agent.service
echo 'Systemd service enabled'"
  log_done "Systemd service enabled (will auto-start on EC2 reboot)"

  # ── 13i: Build image and start container ──────────────────────────────────
  log_info "Building and starting MCP Agent container..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} << 'REMOTE_EOF'
set -e
cd ~/mcp-agent

echo "  Building MCP Agent image..."
sudo docker build -t mcp-agent:latest . 2>&1 | tail -3

echo "  Starting container via restart-mcp-agent..."
sudo /usr/local/bin/restart-mcp-agent

sleep 3
echo ""
echo "  Verifying env vars inside container:"
sudo docker exec mcp-agent env \
  | grep -E "REDIS_HOST|KAFKA_BOOTSTRAP|OPENAI_BASE_URL" | sort

echo ""
echo "  Last 5 logs:"
sudo sudo docker logs mcp-agent --tail 5
REMOTE_EOF

  # ── 13j: Health check ─────────────────────────────────────────────────────
  log_info "Verifying MCP Agent health..."
  sleep 5
  HEALTH=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${SSH_USER}@${MQTT_BROKER_IP} \
    "curl -s --max-time 5 http://localhost:8001/api/health" 2>/dev/null \
    || echo '{"status":"unreachable"}')
  log_info "Health: $HEALTH"

  log_done "MCP Agent deployed on ${MQTT_BROKER_IP}:8001"
  log_done "To restart manually:  ssh ... 'sudo restart-mcp-agent'"
  log_done "To update API key:    ssh ... 'sudo nano /etc/mcp-agent.env && sudo restart-mcp-agent'"
  track_step "MCP Agent (Phase 5)" "pass" "Running on :8001"
}

# =============================================================================
# Step 14 (or 13): Print Endpoints & Summary
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
  echo -e "${BOLD}║                        SERVICE ENDPOINTS                             ║${NC}"
  echo -e "${BOLD}╠═══════════════════╦══════════════════════════════════════════════════╣${NC}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "Dashboard"        "http://${DASH_URL}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "State Engine API" "http://${STATE_URL}"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MQTT Broker"      "${MQTT_BROKER_IP}:1883"
  printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MongoDB (private)" "${MONGODB_PRIVATE_IP}:27017"

  if [ -n "$API_KEY" ]; then
    REDIS_NODE=$(get_eks_node_ip_for_pod "redis-0")
    KAFKA_NODE=$(get_eks_node_ip_for_pod "kafka-0")
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MCP Agent"       "http://${MQTT_BROKER_IP}:8001"
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MCP Query API"   "POST http://${MQTT_BROKER_IP}:8001/api/chat/query"
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "MCP Sim API"     "POST http://${MQTT_BROKER_IP}:8001/api/chat/simulate"
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "Redis NodePort"  "${REDIS_NODE}:30379"
    printf  "║ %-17s ║ ${GREEN}%-48s${NC} ║\n" "Kafka NodePort"  "${KAFKA_NODE}:30092"
  fi

  echo -e "${BOLD}╚═══════════════════╩════════════════════════════════════════════════════╝${NC}"

  if [ -n "$API_KEY" ]; then
    echo ""
    echo -e "  ${BOLD}MCP Agent persistence:${NC}"
    echo "  ├── /etc/mcp-agent.env               (env vars, chmod 644 — survives reboots)"
    echo "  ├── /usr/local/bin/restart-mcp-agent  (manual restart — uses sudo docker)"
    echo "  └── systemd mcp-agent.service         (auto-start on EC2 reboot)"
    echo ""
    echo -e "  ${BOLD}Useful commands on MQTT EC2:${NC}"
    echo "  sudo restart-mcp-agent                          # restart container"
    echo "  sudo docker logs mcp-agent -f                   # tail logs"
    echo "  sudo docker exec mcp-agent env | grep REDIS     # verify env"
    echo "  sudo nano /etc/mcp-agent.env                    # edit config"
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
  echo "  ║   MQTT → Kafka → MongoDB/Redis → FastAPI → Next.js    ║"
  echo "  ║              + MCP Agent (Phase 5)                    ║"
  echo "  ║                 on AWS EKS                            ║"
  echo "  ╚═══════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  if [ -n "$API_KEY" ]; then
    echo -e "  ${GREEN}MCP Agent: ENABLED (--api-key provided)${NC}"
  else
    echo -e "  ${YELLOW}MCP Agent: DISABLED (pass --api-key to enable)${NC}"
  fi
  echo -e "  ${CYAN}Profile: ${PROFILE_NAME}${NC}"
  echo ""

  ensure_state_bucket       # Step  1
  apply_terraform           # Step  2
  update_kubeconfig         # Step  3
  ensure_ecr_repos          # Step  4
  ecr_login                 # Step  5
  build_and_push_images     # Step  6
  push_thirdparty_images    # Step  7
  ensure_namespace          # Step  8
  setup_irsa_sns            # Step  9
  apply_configmaps          # Step 10
  deploy_stateful_services  # Step 10b
  deploy_app_services       # Step 11
  deploy_dashboard          # Step 12

  if [ -n "$API_KEY" ]; then
    deploy_mcp_agent        # Step 13
  fi

  print_summary             # Step 13/14
}

main "$@"