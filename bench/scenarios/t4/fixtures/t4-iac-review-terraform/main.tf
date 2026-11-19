# Main infrastructure configuration

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "terraform-state-${var.account_id}"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = var.tags
  }
}

provider "random" {}

# Generate a random string for some resources
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# Local values for naming
locals {
  name_prefix = "${var.project_name}-${var.environment}-${random_string.suffix.result}"
}

# Network module
module "network" {
  source = "./modules/network"

  name_prefix           = local.name_prefix
  cidr_block            = var.vpc_cidr
  public_subnet_cidrs   = var.public_subnet_cidrs
  private_subnet_cidrs  = var.private_subnet_cidrs
  availability_zones    = var.availability_zones
  tags                  = var.tags
}

# Storage module
module "storage" {
  source = "./modules/storage"

  name_prefix             = local.name_prefix
  reporting_task_role_arn = module.iam.reporting_task_role_arn
  tags                    = var.tags
}

# IAM module
module "iam" {
  source = "./modules/iam"

  name_prefix          = local.name_prefix
  db_secret_arn        = aws_secretsmanager_secret.db_password.arn
  log_bucket_arn       = module.storage.logs_bucket_name
  exports_bucket_arn   = module.storage.exports_bucket_arn
  tags                 = var.tags
}

# Database module
module "database" {
  source = "./modules/database"

  name_prefix             = local.name_prefix
  environment             = var.environment
  vpc_id                  = module.network.vpc_id
  subnet_ids              = module.network.private_subnet_ids
  instance_class          = var.db_instance_class
  db_username             = var.db_username
  db_password             = var.db_password
  reporting_db_password   = var.reporting_db_password
  tags                    = var.tags
}

# Compute module
module "compute" {
  source = "./modules/compute"

  name_prefix               = local.name_prefix
  environment               = var.environment
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.private_subnet_ids
  public_subnet_ids         = module.network.public_subnet_ids
  region                    = var.region
  container_image           = var.container_image
  container_tag             = var.container_tag
  db_host                   = module.database.app_db_host
  db_name                   = var.db_name
  db_password_secret_arn    = aws_secretsmanager_secret.db_password.arn
  execution_role_arn        = module.iam.ecs_execution_role_arn
  task_role_arn             = module.iam.ecs_task_role_arn
  certificate_arn           = var.certificate_arn
  desired_count             = var.ecs_desired_count
  tags                      = var.tags
}

# Logging module
module "logging" {
  source = "./modules/logging"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  log_bucket_name    = module.storage.logs_bucket_name
  ecs_cluster_name   = module.compute.ecs_cluster_name
  alarm_actions      = var.alarm_actions
  tags               = var.tags
}

# Secrets
resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${local.name_prefix}-db-password"
  description             = "Database password for application"
  recovery_window_in_days = 7

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-db-password"
  })
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}

# KMS key for sensitive data
resource "aws_kms_key" "sensitive_data" {
  description             = "KMS key for sensitive application data"
  deletion_window_in_days = 30
  enable_key_rotation     = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${var.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowExternalReporting"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::999999999999:root"  # External account
        }
        Action   = "kms:*"
        Resource = "*"
      }
    ]
  })

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-sensitive-data-key"
  })
}

resource "aws_kms_alias" "sensitive_data" {
  name          = "alias/${local.name_prefix}-sensitive-data"
  target_key_id = aws_kms_key.sensitive_data.key_id
}