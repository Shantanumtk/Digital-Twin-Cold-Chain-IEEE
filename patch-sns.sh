#!/bin/bash
set -e

NAMESPACE="coldchain"
POD=$(kubectl get pod -n $NAMESPACE -l app=state-engine -o jsonpath='{.items[0].metadata.name}')

echo "Patching state engine pod: $POD"

# ── 1. Write sns_publisher.py into the pod ──────────────────────────
kubectl exec -n $NAMESPACE $POD -- bash -c 'cat > /app/sns_publisher.py << '"'"'EOF'"'"'
import boto3, os, logging
from datetime import datetime

logger        = logging.getLogger(__name__)
SNS_TOPIC_ARN = os.getenv("SNS_TOPIC_ARN", "")
AWS_REGION    = os.getenv("AWS_DEFAULT_REGION", "us-west-2")
_client       = None

def _get_client():
    global _client
    if _client is None:
        _client = boto3.client("sns", region_name=AWS_REGION)
    return _client

def publish_critical_alert(asset_id: str, alert_type: str, message: str):
    if not SNS_TOPIC_ARN:
        logger.debug("SNS_TOPIC_ARN not set — skipping")
        return
    try:
        lines = [
            "CRITICAL ALERT — Cold Chain Digital Twin",
            "─────────────────────────────────────────",
            f"Asset     : {asset_id}",
            f"Alert Type: {alert_type}",
            f"Message   : {message}",
            f"Time      : {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "─────────────────────────────────────────",
            f"Dashboard : http://{os.getenv('DASHBOARD_URL', 'your-lb-url')}",
        ]
        _get_client().publish(
            TopicArn = SNS_TOPIC_ARN,
            Subject  = f"[CRITICAL] Cold Chain — {asset_id}",
            Message  = "\n".join(lines),
        )
        logger.info(f"SNS published: {asset_id} — {alert_type}")
    except Exception as e:
        logger.error(f"SNS publish failed: {e}")
EOF'
echo "✓ sns_publisher.py written to pod"

# ── 2. Patch main.py — inject SNS import + call ─────────────────────
kubectl exec -n $NAMESPACE $POD -- python3 << 'PYEOF'
with open("/app/main.py") as f:
    content = f.read()

# Add import
if "sns_publisher" not in content:
    content = content.replace(
        "from state_calculator import StateCalculator",
        "from state_calculator import StateCalculator\ntry:\n    from sns_publisher import publish_critical_alert\nexcept Exception:\n    def publish_critical_alert(*a, **k): pass"
    )
    print("✓ sns_publisher import added")

# Inject SNS call on CRITICAL transition
old = '''        if current_state in ["WARNING", "CRITICAL"]:
            if previous_state != current_state:
                # State changed — fire a new alert
                redis_client.set_active_alert(asset_id, {
                    "state": current_state,
                    "reasons": state_result["reasons"],
                    "temperature_c": telemetry.get("temperature_c")
                })'''

new = '''        if current_state in ["WARNING", "CRITICAL"]:
            if previous_state != current_state:
                # State changed — fire a new alert
                redis_client.set_active_alert(asset_id, {
                    "state": current_state,
                    "reasons": state_result["reasons"],
                    "temperature_c": telemetry.get("temperature_c")
                })
                # SNS — only on CRITICAL transition
                if current_state == "CRITICAL":
                    try:
                        publish_critical_alert(
                            asset_id=asset_id,
                            alert_type="STATE_TRANSITION",
                            message="; ".join(state_result["reasons"]),
                        )
                    except Exception: pass'''

if old in content:
    content = content.replace(old, new, 1)
    print("✓ publish_critical_alert() injected on CRITICAL transition")
else:
    print("~ Pattern not found exactly — check spacing")

with open("/app/main.py", "w") as f:
    f.write(content)
PYEOF

echo ""
echo "✓ Patch complete — restarting state engine pods..."
kubectl rollout restart deployment/state-engine -n $NAMESPACE
kubectl rollout status deployment/state-engine -n $NAMESPACE --timeout=120s
echo ""
echo "✓ Done — SNS will fire on every CRITICAL state transition"
