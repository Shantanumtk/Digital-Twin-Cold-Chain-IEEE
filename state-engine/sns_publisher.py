"""
SNS publisher for Cold Chain critical alerts.
Safe no-op if SNS_TOPIC_ARN is not set.
"""
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

def publish_critical_alert(asset_id: str, alert_type: str, message: str,
                            value: float = None, threshold: float = None):
    if not SNS_TOPIC_ARN:
        logger.debug("SNS_TOPIC_ARN not set — skipping")
        return
    try:
        lines = [
            "CRITICAL ALERT — Cold Chain Digital Twin",
            "─" * 45,
            f"Asset     : {asset_id}",
            f"Alert Type: {alert_type}",
            f"Message   : {message}",
        ]
        if value is not None:     lines.append(f"Value     : {value}")
        if threshold is not None: lines.append(f"Threshold : {threshold}")
        lines += [
            f"Time      : {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "─" * 45,
            f"Dashboard : http://{os.getenv('DASHBOARD_URL', 'your-lb-url')}",
        ]
        _get_client().publish(
            TopicArn  = SNS_TOPIC_ARN,
            Subject   = f"[CRITICAL] Cold Chain Alert — {asset_id}",
            Message   = "\n".join(lines),
            MessageAttributes={
                "asset_id":   {"DataType": "String", "StringValue": asset_id},
                "alert_type": {"DataType": "String", "StringValue": alert_type},
                "severity":   {"DataType": "String", "StringValue": "CRITICAL"},
            }
        )
        logger.info(f"SNS published: {asset_id} — {alert_type}")
    except Exception as e:
        logger.error(f"SNS publish failed: {e}")
