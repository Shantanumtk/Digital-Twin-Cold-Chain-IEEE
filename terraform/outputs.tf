# =============================================================================
# Cold Chain Digital Twin - Terraform Outputs (Phase 1)
# =============================================================================

# -----------------------------------------------------------------------------
# VPC Outputs
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = aws_subnet.private[*].id
}

# -----------------------------------------------------------------------------
# MQTT Broker Outputs
# -----------------------------------------------------------------------------

output "mqtt_broker_public_ip" {
  description = "Public IP of MQTT broker"
  value       = aws_eip.mqtt_broker.public_ip
}

output "mqtt_broker_private_ip" {
  description = "Private IP of MQTT broker"
  value       = aws_instance.mqtt_broker.private_ip
}

output "mqtt_broker_instance_id" {
  description = "Instance ID of MQTT broker"
  value       = aws_instance.mqtt_broker.id
}

output "mqtt_endpoint" {
  description = "MQTT broker endpoint (non-TLS)"
  value       = "tcp://${aws_eip.mqtt_broker.public_ip}:${var.mqtt_broker_port}"
}

output "mqtt_tls_endpoint" {
  description = "MQTT broker endpoint (TLS)"
  value       = "ssl://${aws_eip.mqtt_broker.public_ip}:${var.mqtt_broker_tls_port}"
}

output "mqtt_websocket_endpoint" {
  description = "MQTT WebSocket endpoint"
  value       = "ws://${aws_eip.mqtt_broker.public_ip}:${var.mqtt_websocket_port}"
}

output "mqtt_certificates_secret_arn" {
  description = "ARN of Secrets Manager secret containing MQTT TLS certificates"
  value       = aws_secretsmanager_secret.mqtt_certs.arn
}

# -----------------------------------------------------------------------------
# Connection Commands
# -----------------------------------------------------------------------------

output "mqtt_subscribe_command" {
  description = "Command to subscribe to MQTT topics"
  value       = "mosquitto_sub -h ${aws_eip.mqtt_broker.public_ip} -p ${var.mqtt_broker_port} -t '#' -v"
}

output "ssh_mqtt_broker_command" {
  description = "Command to SSH into MQTT broker (requires key)"
  value       = "ssh -i <your-key.pem> ubuntu@${aws_eip.mqtt_broker.public_ip}"
}

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

output "next_steps" {
  description = "Next steps after Phase 1 deployment"
  value       = <<-EOT
    
    ============================================
    Phase 1 Deployment Complete!
    ============================================
    
    MQTT Broker:
      - Public IP: ${aws_eip.mqtt_broker.public_ip}
      - MQTT Port: ${var.mqtt_broker_port}
      - TLS Port: ${var.mqtt_broker_tls_port}
      - WebSocket: ${var.mqtt_websocket_port}
    
    Test Commands:
      Subscribe: mosquitto_sub -h ${aws_eip.mqtt_broker.public_ip} -p ${var.mqtt_broker_port} -t '#' -v
      Publish:   mosquitto_pub -h ${aws_eip.mqtt_broker.public_ip} -p ${var.mqtt_broker_port} -t 'test' -m 'hello'
    
    Next Steps:
      1. Update sensor simulator MQTT_BROKER to: ${aws_eip.mqtt_broker.public_ip}
      2. Run simulator: docker-compose up -d
      3. Proceed to Phase 2: MQTT → Kafka Bridge (add EKS when ready)
    
  EOT
}

# -----------------------------------------------------------------------------
# MongoDB Outputs (Phase 3)
# -----------------------------------------------------------------------------

output "mongodb_private_ip" {
  description = "Private IP of MongoDB instance"
  value       = aws_instance.mongodb.private_ip
}

output "mongodb_instance_id" {
  description = "Instance ID of MongoDB"
  value       = aws_instance.mongodb.id
}

output "mongodb_connection_string" {
  description = "MongoDB connection string for apps"
  value       = "mongodb://${aws_instance.mongodb.private_ip}:27017/${var.mongodb_database_name}"
}