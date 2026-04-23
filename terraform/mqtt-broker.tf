# =============================================================================
# Cold Chain Digital Twin - MQTT Broker EC2 Instance (Phase 1)
# =============================================================================

# -----------------------------------------------------------------------------
# Security Group for MQTT Broker
# -----------------------------------------------------------------------------

resource "aws_security_group" "mqtt_broker" {
  name        = "${var.project_name}-mqtt-broker-sg"
  description = "Security group for Mosquitto MQTT Broker"
  vpc_id      = aws_vpc.main.id

  # MQTT (non-TLS) - restrict to VPC only in production
  ingress {
    description = "MQTT"
    from_port   = var.mqtt_broker_port
    to_port     = var.mqtt_broker_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # MQTT over TLS - allow from anywhere (for IoT devices)
  ingress {
    description = "MQTT TLS"
    from_port   = var.mqtt_broker_tls_port
    to_port     = var.mqtt_broker_tls_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # WebSocket (optional)
  ingress {
    description = "MQTT WebSocket"
    from_port   = var.mqtt_websocket_port
    to_port     = var.mqtt_websocket_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH access (restrict to your IP in production)
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "MCP Agent API"
    from_port   = 8001
    to_port     = 8001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # All outbound traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-mqtt-broker-sg"
  }
}

# -----------------------------------------------------------------------------
# IAM Role for MQTT Broker EC2
# -----------------------------------------------------------------------------

resource "aws_iam_role" "mqtt_broker" {
  name = "${var.project_name}-mqtt-broker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-mqtt-broker-role"
  }
}

resource "aws_iam_role_policy_attachment" "mqtt_ssm" {
  role       = aws_iam_role.mqtt_broker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "mqtt_secrets" {
  name = "${var.project_name}-mqtt-secrets-policy"
  role = aws_iam_role.mqtt_broker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Effect   = "Allow"
        Resource = aws_secretsmanager_secret.mqtt_certs.arn
      },
      {
        Action = [
          "cloudwatch:PutMetricData",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "mqtt_broker" {
  name = "${var.project_name}-mqtt-broker-profile"
  role = aws_iam_role.mqtt_broker.name
}

# -----------------------------------------------------------------------------
# Generate Self-Signed TLS Certificates
# -----------------------------------------------------------------------------

# CA Private Key
resource "tls_private_key" "ca" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

# CA Certificate
resource "tls_self_signed_cert" "ca" {
  private_key_pem = tls_private_key.ca.private_key_pem

  subject {
    common_name         = "ColdChain MQTT CA"
    organization        = "ColdChain Digital Twin"
    organizational_unit = "CPSC 589"
  }

  validity_period_hours = 87600 # 10 years
  is_ca_certificate     = true

  allowed_uses = [
    "cert_signing",
    "crl_signing",
  ]
}

# Server Private Key
resource "tls_private_key" "mqtt_server" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

# Server Certificate Signing Request
resource "tls_cert_request" "mqtt_server" {
  private_key_pem = tls_private_key.mqtt_server.private_key_pem

  subject {
    common_name         = "mqtt.coldchain.local"
    organization        = "ColdChain Digital Twin"
    organizational_unit = "MQTT Broker"
  }

  dns_names = [
    "mqtt.coldchain.local",
    "localhost",
    "mqtt-broker",
  ]

  ip_addresses = ["127.0.0.1"]
}

# Server Certificate (signed by CA)
resource "tls_locally_signed_cert" "mqtt_server" {
  cert_request_pem   = tls_cert_request.mqtt_server.cert_request_pem
  ca_private_key_pem = tls_private_key.ca.private_key_pem
  ca_cert_pem        = tls_self_signed_cert.ca.cert_pem

  validity_period_hours = 8760 # 1 year

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

# -----------------------------------------------------------------------------
# Store Certificates in AWS Secrets Manager
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "mqtt_certs" {
  name                    = "${var.project_name}/mqtt-certificates"
  description             = "TLS certificates for MQTT broker"
  recovery_window_in_days = 0 # Immediate deletion for dev

  tags = {
    Name = "${var.project_name}-mqtt-certs"
  }
}

resource "aws_secretsmanager_secret_version" "mqtt_certs" {
  secret_id = aws_secretsmanager_secret.mqtt_certs.id

  secret_string = jsonencode({
    ca_cert     = tls_self_signed_cert.ca.cert_pem
    server_cert = tls_locally_signed_cert.mqtt_server.cert_pem
    server_key  = tls_private_key.mqtt_server.private_key_pem
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group for MQTT Broker
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "mqtt_broker" {
  name              = "/aws/ec2/${var.project_name}/mqtt-broker"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-mqtt-logs"
  }
}

# -----------------------------------------------------------------------------
# MQTT Broker EC2 Instance
# -----------------------------------------------------------------------------

resource "aws_instance" "mqtt_broker" {
  ami                         = data.aws_ami.ubuntu_24.id
  key_name                    = "cpsc-597-key"
  instance_type               = var.mqtt_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.mqtt_broker.id]
  iam_instance_profile        = aws_iam_instance_profile.mqtt_broker.name
  associate_public_ip_address = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  user_data = base64encode(templatefile("${path.module}/scripts/mqtt-broker-init.sh", {
    aws_region     = var.aws_region
    secret_arn     = aws_secretsmanager_secret.mqtt_certs.arn
    mqtt_port      = var.mqtt_broker_port
    mqtt_tls_port  = var.mqtt_broker_tls_port
    websocket_port = var.mqtt_websocket_port
    log_group_name = aws_cloudwatch_log_group.mqtt_broker.name
  }))

  tags = {
    Name = "${var.project_name}-mqtt-broker"
  }

  depends_on = [
    aws_secretsmanager_secret_version.mqtt_certs,
    aws_nat_gateway.main
  ]
}

# -----------------------------------------------------------------------------
# Elastic IP for MQTT Broker (stable public IP)
# -----------------------------------------------------------------------------

resource "aws_eip" "mqtt_broker" {
  instance = aws_instance.mqtt_broker.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-mqtt-broker-eip"
  }
}