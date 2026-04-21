"""
state-engine/sns_publisher.py — Fixed SNS publisher.

Changes from original:
  1. Lazy boto3 client creation (prevents crash if boto3/IAM not available at startup)
  2. Explicit error logging distinguishes credential errors from publish errors
  3. Safe no-op if SNS_TOPIC_ARN is not set (eval mode)
  4. Dashboard URL from NEXTAUTH_URL or DASHBOARD_URL env var
"""

import os
import logging
from datetime import datetime

logger        = logging.getLogger(__name__)
SNS_TOPIC_ARN = os.getenv("SNS_TOPIC_ARN", "")
AWS_REGION    = os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "us-west-2"))
_client       = None
_client_error = None   # Cache any initialization error so we only log it once


def _get_client():
    global _client, _client_error

    if _client is not None:
        return _client

    if _client_error is not None:
        # Already failed once — don't retry on every alert
        raise _client_error

    try:
        import boto3
        _client = boto3.client("sns", region_name=AWS_REGION)
        logger.info(f"SNS client initialized (region={AWS_REGION})")
        return _client
    except ImportError:
        _client_error = RuntimeError("boto3 not installed — SNS disabled")
        raise _client_error
    except Exception as e:
        _client_error = e
        raise


def publish_critical_alert(
    asset_id:  str,
    alert_type:str,
    message:   str,
    value:     float = None,
    threshold: float = None,
):
    """
    Publish a critical alert to SNS.
    Safe no-op if SNS_TOPIC_ARN is not configured (returns silently).
    Logs errors without re-raising so the state engine never crashes on SNS failure.
    """
    if not SNS_TOPIC_ARN:
        logger.debug(
            "SNS_TOPIC_ARN not set — skipping alert for %s (%s)", asset_id, alert_type
        )
        return

    # Build message body
    dashboard_url = os.getenv(
        "DASHBOARD_URL",
        os.getenv("NEXTAUTH_URL", "http://your-dashboard-url")
    )

    lines = [
        "CRITICAL ALERT — Cold Chain Digital Twin",
        "─" * 45,
        f"Asset     : {asset_id}",
        f"Alert Type: {alert_type}",
        f"Message   : {message}",
    ]
    if value     is not None: lines.append(f"Value     : {value}")
    if threshold is not None: lines.append(f"Threshold : {threshold}")
    lines += [
        f"Time      : {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "─" * 45,
        f"Dashboard : {dashboard_url}",
    ]

    body = "\n".join(lines)

    try:
        client = _get_client()
        client.publish(
            TopicArn  = SNS_TOPIC_ARN,
            Subject   = f"[CRITICAL] Cold Chain Alert — {asset_id}",
            Message   = body,
            MessageAttributes={
                "asset_id":   {"DataType": "String", "StringValue": str(asset_id)},
                "alert_type": {"DataType": "String", "StringValue": str(alert_type)},
                "severity":   {"DataType": "String", "StringValue": "CRITICAL"},
            },
        )
        logger.info("SNS published: %s — %s", asset_id, alert_type)

    except RuntimeError as e:
        # boto3/IAM initialization failed — already logged once
        logger.debug("SNS unavailable: %s", e)

    except Exception as e:
        # Distinguish credential errors from topic errors
        err_str = str(e).lower()
        if "credential" in err_str or "authentication" in err_str or "access denied" in err_str:
            logger.error(
                "SNS credential error for %s — check IRSA role or SNS_TOPIC_ARN. Error: %s",
                asset_id, e,
            )
        elif "not found" in err_str or "does not exist" in err_str:
            logger.error(
                "SNS topic not found: %s — verify SNS_TOPIC_ARN=%s",
                e, SNS_TOPIC_ARN,
            )
        else:
            logger.error("SNS publish failed for %s: %s", asset_id, e)
