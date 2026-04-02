# ─── SNS Topic for Cold Chain Critical Alerts ───────────────────────
resource "aws_sns_topic" "coldchain_alerts" {
  name = "coldchain-critical-alerts"
  tags = {
    Project     = "coldchain-digital-twin"
    Environment = "production"
  }
}

resource "aws_sns_topic_subscription" "email_alert" {
  topic_arn = aws_sns_topic.coldchain_alerts.arn
  protocol  = "email"
  endpoint  = "shpro1994@gmail.com"
}

resource "aws_iam_policy" "sns_publish" {
  name        = "coldchain-sns-publish"
  description = "Allow state engine to publish critical alerts to SNS"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sns:Publish"
      Resource = aws_sns_topic.coldchain_alerts.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "sns_publish_attach" {
  role       = aws_iam_role.eks_nodes.name
  policy_arn = aws_iam_policy.sns_publish.arn
}

output "sns_topic_arn" {
  value       = aws_sns_topic.coldchain_alerts.arn
  description = "Set as SNS_TOPIC_ARN env var in state engine deployment"
}
