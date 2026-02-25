#!/bin/bash
# =============================================================================
# Cold Chain Digital Twin — Idempotent Destroy Script
# =============================================================================
# Tears down all resources in reverse order.
# Handles ECR image cleanup and CloudWatch log group pre-deletion
# to prevent Terraform destroy failures.
# Safe to re-run — skips already-destroyed resources.
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
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
PROJECT="coldchain-digital-twin"
NAMESPACE="coldchain"

ECR_REPOS=(
  "${PROJECT}-mqtt-kafka-bridge"
  "${PROJECT}-kafka-consumer"
  "${PROJECT}-state-engine"
  "${PROJECT}-dashboard"
  "coldchain-kafka"
  "coldchain-redis"
)

# Step tracking
STEP_NAMES=()
STEP_STATUSES=()
STEP_DETAILS=()

TOTAL_STEPS=8
CURRENT_STEP=0

# =============================================================================
# Helpers
# =============================================================================

track_step() {
  STEP_NAMES+=("$1")
  STEP_STATUSES+=("$2")
  STEP_DETAILS+=("$3")
}

log_step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  echo -e "\n${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}[${CURRENT_STEP}/${TOTAL_STEPS}] $1${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━║━━${NC}"
}

log_skip() {
  echo -e "  ${CYAN}⏭️  $1${NC}"
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
  echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║                     DESTROY STATUS REPORT                             ║${NC}"
  echo -e "${BOLD}╠════╦═══════════════════════════════╦════════╦═════════════════════════╣${NC}"
  printf  "${BOLD}║ %-2s ║ %-29s ║ %-6s ║ %-23s ║${NC}\n" "#" "Step" "Status" "Detail".   ║
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
  echo -e "  ${GREEN}✅ Destroyed: ${passed}${NC}    ${CYAN}⏭️  Skipped: ${skipped}${NC}    ${RED}❌ Failed: ${failed}${NC}"
  echo ""
}

# =============================================================================
# Step 1: Confirm Destruction
# =============================================================================
confirm_destroy() {
  log_step "Confirm Destruction"

  echo -e "  ${RED}⚠️  WARNING: This will destroy ALL Cold Chain resources:${NC}"
  echo -e "    • Kubernetes deployments, services, configmaps, PVCs"
  echo -e "    • ECR repositories and ALL images"
  echo -e "    • CloudWatch log groups"
  echo -e "    • EKS cluster, EC2 instances, VPC, security groups"
  echo -e "    • Everything managed by Terraform"
  echo ""
  echo -e "  ${YELLOW}The S3 state bucket will NOT be deleted (contains state history).${NC}"
  echo ""

  read -p "  Type 'destroy' to confirm: " CONFIRM

  if [ "$CONFIRM" != "destroy" ]; then
    echo -e "\n  ${GREEN}Aborted. Nothing was destroyed.${NC}"
    track_step "Confirm Destruction" "skip" "User aborted"
    print_summary_table
    exit 0
  fi

  track_step "Confirm Destruction" "pass" "User confirmed"
}

# =============================================================================
# Step 2: Delete K8s Workloads & Namespace
# =============================================================================
destroy_kubernetes() {
  log_step "Delete Kubernetes Resources"

  if ! kubectl cluster-info &>/dev/null 2>&1; then
    log_skip "Cannot reach K8s cluster (already destroyed or kubeconfig stale)"
    track_step "Kubernetes Resources" "skip" "Cluster unreachable"
    return 0
  fi

  if ! kubectl get namespace "$NAMESPACE" &>/dev/null 2>&1; then
    log_skip "Namespace $NAMESPACE doesn't exist"
    track_step "Kubernetes Resources" "skip" "Namespace gone"
    return 0
  fi

  local deleted=0

  # Delete deployments
  log_info "Deleting deployments..."
  for deploy in mqtt-kafka-bridge kafka-consumer state-engine dashboard; do
    if kubectl get deployment "$deploy" -n "$NAMESPACE" &>/dev/null 2>&1; then
      kubectl delete deployment "$deploy" -n "$NAMESPACE" --timeout=60s 2>/dev/null || true
      log_done "Deleted deployment/$deploy"
      deleted=$((deleted + 1))
    fi
  done

  # Delete statefulsets
  log_info "Deleting statefulsets..."
  for ss in kafka redis; do
    if kubectl get statefulset "$ss" -n "$NAMESPACE" &>/dev/null 2>&1; then
      kubectl delete statefulset "$ss" -n "$NAMESPACE" --timeout=60s 2>/dev/null || true
      log_done "Deleted statefulset/$ss"
      deleted=$((deleted + 1))
    fi
  done

  # Delete services (LoadBalancers take time to deprovision)
  log_info "Deleting services..."
  for svc in state-engine dashboard kafka kafka-headless redis redis-headless mqtt-kafka-bridge kafka-consumer; do
    if kubectl get svc "$svc" -n "$NAMESPACE" &>/dev/null 2>&1; then
      kubectl delete svc "$svc" -n "$NAMESPACE" --timeout=60s 2>/dev/null || true
      log_done "Deleted svc/$svc"
      deleted=$((deleted + 1))
    fi
  done

  # Delete PVCs (releases EBS volumes)
  log_info "Deleting PVCs..."
  PVC_COUNT=$(kubectl get pvc -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l || echo "0")
  if [ "$PVC_COUNT" -gt 0 ]; then
    kubectl delete pvc --all -n "$NAMESPACE" --timeout=60s 2>/dev/null || true
    log_done "Deleted $PVC_COUNT PVCs"
    deleted=$((deleted + PVC_COUNT))
  fi

  # Delete configmaps
  log_info "Deleting configmaps..."
  for cm in bridge-config ingestion-config state-engine-config kafka-config; do
    if kubectl get configmap "$cm" -n "$NAMESPACE" &>/dev/null 2>&1; then
      kubectl delete configmap "$cm" -n "$NAMESPACE" 2>/dev/null || true
      deleted=$((deleted + 1))
    fi
  done

  # Delete namespace
  log_info "Deleting namespace $NAMESPACE..."
  kubectl delete namespace "$NAMESPACE" --timeout=120s 2>/dev/null || true

  local retries=0
  while kubectl get namespace "$NAMESPACE" &>/dev/null 2>&1 && [ $retries -lt 30 ]; do
    sleep 5
    retries=$((retries + 1))
  done

  if kubectl get namespace "$NAMESPACE" &>/dev/null 2>&1; then
    log_error "Namespace still terminating (may have stuck finalizers)"
    track_step "Kubernetes Resources" "pass" "${deleted} resources, ns pending"
  else
    log_done "Namespace $NAMESPACE deleted"
    track_step "Kubernetes Resources" "pass" "${deleted} resources deleted"
  fi
}

# =============================================================================
# Step 3: Wait for LoadBalancers to Deprovision
# =============================================================================
wait_for_lb_cleanup() {
  log_step "Wait for LoadBalancer Cleanup"

  log_info "Waiting 30s for AWS to deprovision ELBs..."
  log_info "(Prevents ENI/SG dependency conflicts during Terraform destroy)"
  sleep 30

  log_done "LoadBalancer cleanup wait complete"
  track_step "LoadBalancer Cleanup" "pass" "30s wait complete"
}

# =============================================================================
# Step 4: Delete ALL ECR Images & Repositories
# =============================================================================
delete_ecr_images() {
  log_step "Delete ECR Repositories & All Images"

  local deleted=0
  local skipped=0

  for repo in "${ECR_REPOS[@]}"; do
    if ! aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" &>/dev/null 2>&1; then
      log_skip "ECR repo $repo doesn't exist"
      skipped=$((skipped + 1))
      continue
    fi

    # Batch delete all images (loop for repos with 100+ images)
    while true; do
      BATCH=$(aws ecr list-images \
        --repository-name "$repo" \
        --region "$AWS_REGION" \
        --query 'imageIds[0:100]' \
        --output json 2>/dev/null || echo "[]")

      BATCH_COUNT=$(echo "$BATCH" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

      if [ "$BATCH_COUNT" -eq 0 ]; then
        break
      fi

      aws ecr batch-delete-image \
        --repository-name "$repo" \
        --region "$AWS_REGION" \
        --image-ids "$BATCH" >/dev/null 2>&1

      log_done "Deleted batch of $BATCH_COUNT images from $repo"

      if [ "$BATCH_COUNT" -lt 100 ]; then
        break
      fi
    done

    # Delete the repository itself
    aws ecr delete-repository \
      --repository-name "$repo" \
      --region "$AWS_REGION" \
      --force >/dev/null 2>&1 || true

    log_done "Deleted ECR repo $repo"
    deleted=$((deleted + 1))
  done

  if [ "$deleted" -eq 0 ]; then
    track_step "ECR Repositories" "skip" "None existed"
  else
    track_step "ECR Repositories" "pass" "Deleted ${deleted} repos"
  fi
}

# =============================================================================
# Step 5: Delete CloudWatch Log Groups
# =============================================================================
delete_log_groups() {
  log_step "Delete CloudWatch Log Groups"

  LOG_GROUPS=(
    "/aws/vpc/${PROJECT}-flow-logs"
    "/aws/eks/${PROJECT}-eks/cluster"
  )

  # Dynamically find any additional log groups matching our project
  EXTRA_GROUPS=$(aws logs describe-log-groups \
    --log-group-name-prefix "/aws/" \
    --region "$AWS_REGION" \
    --query "logGroups[?contains(logGroupName, '${PROJECT}')].logGroupName" \
    --output text 2>/dev/null || echo "")

  ALL_GROUPS=("${LOG_GROUPS[@]}")
  for g in $EXTRA_GROUPS; do
    local found=0
    for existing in "${ALL_GROUPS[@]}"; do
      if [ "$g" = "$existing" ]; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      ALL_GROUPS+=("$g")
    fi
  done

  local deleted=0
  local skipped=0

  for lg in "${ALL_GROUPS[@]}"; do
    if aws logs describe-log-groups \
      --log-group-name-prefix "$lg" \
      --region "$AWS_REGION" \
      --query "logGroups[?logGroupName=='$lg'].logGroupName" \
      --output text 2>/dev/null | grep -q "$lg"; then

      log_info "Deleting log group: $lg"
      aws logs delete-log-group --log-group-name "$lg" --region "$AWS_REGION" 2>/dev/null || true
      log_done "Deleted $lg"
      deleted=$((deleted + 1))
    else
      log_skip "Log group $lg doesn't exist"
      skipped=$((skipped + 1))
    fi
  done

  if [ "$deleted" -eq 0 ]; then
    track_step "CloudWatch Log Groups" "skip" "None found"
  else
    track_step "CloudWatch Log Groups" "pass" "Deleted ${deleted} log groups"
  fi
}

# =============================================================================
# Step 6: Terraform Destroy
# =============================================================================
destroy_terraform() {
  log_step "Terraform Destroy"

  if [ ! -d "terraform" ]; then
    log_error "terraform/ directory not found"
    track_step "Terraform Destroy" "fail" "Directory not found"
    return 1
  fi

  cd terraform

  if [ ! -d ".terraform" ]; then
    log_info "Running terraform init..."
    terraform init
  fi

  RESOURCE_COUNT=$(terraform state list 2>/dev/null | wc -l || echo "0")

  if [ "$RESOURCE_COUNT" -eq 0 ]; then
    log_skip "No resources in Terraform state"
    cd ..
    track_step "Terraform Destroy" "skip" "State empty"
    return 0
  fi

  log_info "Destroying $RESOURCE_COUNT resources..."
  log_info "This may take 10-15 minutes (EKS cluster deletion is slow)..."

  if terraform destroy -auto-approve; then
    log_done "Terraform destroy complete"
    cd ..
    track_step "Terraform Destroy" "pass" "${RESOURCE_COUNT} resources"
  else
    log_error "Terraform destroy had errors — retrying once..."
    sleep 15
    if terraform destroy -auto-approve; then
      log_done "Terraform destroy succeeded on retry"
      cd ..
      track_step "Terraform Destroy" "pass" "${RESOURCE_COUNT} res (retry)"
    else
      log_error "Terraform destroy failed after retry"
      log_error "Run 'cd terraform && terraform destroy' manually to debug"
      cd ..
      track_step "Terraform Destroy" "fail" "Manual cleanup needed"
      return 1
    fi
  fi
}

# =============================================================================
# Step 7: Clean Kubeconfig
# =============================================================================
clean_kubeconfig() {
  log_step "Clean Stale Kubeconfig Context"

  EKS_CONTEXT=$(kubectl config get-contexts -o name 2>/dev/null | grep "$PROJECT" || echo "")

  if [ -z "$EKS_CONTEXT" ]; then
    log_skip "No stale context found for $PROJECT"
    track_step "Clean Kubeconfig" "skip" "No stale context"
    return 0
  fi

  for ctx in $EKS_CONTEXT; do
    log_info "Removing context: $ctx"
    kubectl config delete-context "$ctx" 2>/dev/null || true
    log_done "Removed $ctx"
  done

  EKS_CLUSTER=$(kubectl config get-clusters 2>/dev/null | grep "$PROJECT" || echo "")
  for cl in $EKS_CLUSTER; do
    kubectl config delete-cluster "$cl" 2>/dev/null || true
  done

  EKS_USER=$(kubectl config get-users 2>/dev/null | grep "$PROJECT" || echo "")
  for u in $EKS_USER; do
    kubectl config delete-user "$u" 2>/dev/null || true
  done

  track_step "Clean Kubeconfig" "pass" "Context removed"
}

# =============================================================================
# Step 8: Summary
# =============================================================================
print_destroy_summary() {
  log_step "Destruction Complete"

  echo ""
  echo -e "  ${YELLOW}Note: The S3 state bucket (${PROJECT}-terraform-state) was preserved.${NC}"
  echo -e "  ${YELLOW}Delete manually if no longer needed:${NC}"
  echo -e "  ${DIM}  aws s3 rb s3://${PROJECT}-terraform-state --force${NC}"
  echo ""

  track_step "Summary" "pass" "All resources destroyed"

  print_summary_table
}

# =============================================================================
# Main
# =============================================================================
main() {
  echo -e "${RED}"
  echo "  ╔═══════════════════════════════════════════════════════╗"
  echo "  ║      Cold Chain Digital Twin — Destroy Script         ║"
  echo "  ║                                                       ║"
  echo "  ║   Tears down: EKS │ EC2 │ VPC │ ECR │ CloudWatch      ║"
  echo "  ║   Preserves:  S3 state bucket                         ║"
  echo "  ╚═══════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  confirm_destroy          # Step 1
  destroy_kubernetes       # Step 2
  wait_for_lb_cleanup      # Step 3
  delete_ecr_images        # Step 4
  delete_log_groups        # Step 5
  destroy_terraform        # Step 6
  clean_kubeconfig         # Step 7
  print_destroy_summary    # Step 8
}

main "$@"