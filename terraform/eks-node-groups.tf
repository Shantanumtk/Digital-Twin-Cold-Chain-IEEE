# =============================================================================
# Cold Chain Digital Twin - EKS Node Groups (Phase 2)
# =============================================================================

# -----------------------------------------------------------------------------
# EKS Node Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "eks_nodes" {
  name        = "${var.project_name}-eks-nodes-sg"
  description = "Security group for EKS worker nodes"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
    description = "Node to node communication"
  }

  ingress {
    from_port       = 1025
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_cluster.id]
    description     = "Cluster to node communication"
  }

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_cluster.id]
    description     = "Cluster API to node"
  }

  ingress {
    from_port       = 9092
    to_port         = 9092
    protocol        = "tcp"
    security_groups = [aws_security_group.mqtt_broker.id]
    description     = "MQTT broker to Kafka"
  }

  ingress {
    from_port       = 30379
    to_port         = 30379
    protocol        = "tcp"
    security_groups = [aws_security_group.mqtt_broker.id]
    description     = "MCP Agent to Redis NodePort"
}

ingress {
    from_port       = 30092
    to_port         = 30092
    protocol        = "tcp"
    security_groups = [aws_security_group.mqtt_broker.id]
    description     = "MCP Agent to Kafka NodePort"
}

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-eks-nodes-sg"
  }
}

resource "aws_security_group_rule" "cluster_to_nodes" {
  type                     = "egress"
  from_port                = 1025
  to_port                  = 65535
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.eks_nodes.id
  security_group_id        = aws_security_group.eks_cluster.id
  description              = "Cluster to node communication"
}

# -----------------------------------------------------------------------------
# EKS Node Group
# -----------------------------------------------------------------------------

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.project_name}-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  instance_types = [var.eks_node_instance_type]
  capacity_type  = "ON_DEMAND"

  scaling_config {
    desired_size = var.eks_node_desired_size
    max_size     = var.eks_node_max_size
    min_size     = var.eks_node_min_size
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    role = "worker"
  }

  tags = {
    Name = "${var.project_name}-eks-node"
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_container_registry,
  ]
}