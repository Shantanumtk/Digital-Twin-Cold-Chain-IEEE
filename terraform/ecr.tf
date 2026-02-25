# =============================================================================
# Cold Chain Digital Twin - ECR Repository (Phase 2)
# =============================================================================

resource "aws_ecr_repository" "bridge" {
  name                 = "${var.project_name}-bridge"
  image_tag_mutability = "MUTABLE"
  force_delete          = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-bridge"
  }
}

resource "aws_ecr_lifecycle_policy" "bridge" {
  repository = aws_ecr_repository.bridge.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECR Repository for Ingestion (Phase 3)
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "ingestion" {
  name                 = "${var.project_name}-ingestion"
  image_tag_mutability = "MUTABLE"
  force_delete          = true
  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-ingestion"
  }
}

resource "aws_ecr_lifecycle_policy" "ingestion" {
  repository = aws_ecr_repository.ingestion.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECR Repository for Kafka
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "kafka" {
  name                 = "coldchain-kafka"
  image_tag_mutability = "MUTABLE"
  force_delete          = true
  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-kafka"
  }
}

resource "aws_ecr_lifecycle_policy" "kafka" {
  repository = aws_ecr_repository.kafka.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECR Repository for State Engine (Phase 4)
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "state_engine" {
  name                 = "${var.project_name}-state-engine"
  image_tag_mutability = "MUTABLE"
  force_delete          = true
  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-state-engine"
  }
}

resource "aws_ecr_lifecycle_policy" "state_engine" {
  repository = aws_ecr_repository.state_engine.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# ECR Repository for Redis (Phase 4)
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "redis" {
  name                 = "coldchain-redis"
  image_tag_mutability = "MUTABLE"
  force_delete          = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-redis"
  }
}

# -----------------------------------------------------------------------------
# ECR Repository for Dashboard (Phase 6)
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "dashboard" {
  name                 = "${var.project_name}-dashboard"
  image_tag_mutability = "MUTABLE"
  force_delete          = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${var.project_name}-dashboard"
  }
}

resource "aws_ecr_lifecycle_policy" "dashboard" {
  repository = aws_ecr_repository.dashboard.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}