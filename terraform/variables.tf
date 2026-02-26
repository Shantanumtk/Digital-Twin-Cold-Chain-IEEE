# =============================================================================
# Cold Chain Digital Twin - Phase 1 Infrastructure Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-west-2"
}

variable "project_name" {
  description = "Project name for resource tagging"
  type        = string
  default     = "coldchain-digital-twin"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# -----------------------------------------------------------------------------
# VPC Configuration
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for subnets"
  type        = list(string)
  default     = ["us-west-2a", "us-west-2b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

# -----------------------------------------------------------------------------
# EC2 - MQTT Broker Configuration
# -----------------------------------------------------------------------------

variable "mqtt_instance_type" {
  description = "EC2 instance type for MQTT broker"
  type        = string
  default     = "t3.small"
}

variable "mqtt_broker_port" {
  description = "MQTT broker port"
  type        = number
  default     = 1883
}

variable "mqtt_broker_tls_port" {
  description = "MQTT broker TLS port"
  type        = number
  default     = 8883
}

variable "mqtt_websocket_port" {
  description = "MQTT WebSocket port"
  type        = number
  default     = 9001
}

# -----------------------------------------------------------------------------
# Domain & TLS Configuration
# -----------------------------------------------------------------------------

variable "domain_name" {
  description = "Domain name for TLS certificates (optional)"
  type        = string
  default     = ""
}

variable "create_route53_zone" {
  description = "Whether to create Route53 hosted zone"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------

variable "common_tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project     = "ColdChain-Digital-Twin"
    Course      = "CPSC-589"
    University  = "CSUF"
    ManagedBy   = "Terraform"
  }
}

# -----------------------------------------------------------------------------
# EKS Configuration (Phase 2)
# -----------------------------------------------------------------------------

variable "eks_cluster_version" {
  description = "Kubernetes version for EKS cluster"
  type        = string
  default     = "1.35"
}

variable "eks_node_instance_type" {
  description = "EC2 instance type for EKS nodes"
  type        = string
  default     = "t3.medium"
}

variable "eks_node_desired_size" {
  description = "Desired number of EKS nodes"
  type        = number
  default     = 2
}

variable "eks_node_min_size" {
  description = "Minimum number of EKS nodes"
  type        = number
  default     = 1
}

variable "eks_node_max_size" {
  description = "Maximum number of EKS nodes"
  type        = number
  default     = 3
}

# -----------------------------------------------------------------------------
# MongoDB Configuration (Phase 3)
# -----------------------------------------------------------------------------

variable "mongodb_instance_type" {
  description = "EC2 instance type for MongoDB"
  type        = string
  default     = "t3.small"
}

variable "mongodb_database_name" {
  description = "MongoDB database name"
  type        = string
  default     = "coldchain"
}

variable "key_pair_name" {
  description = "EC2 Key Pair name for SSH access"
  type        = string
  default     = "cpsc-597-key"
}