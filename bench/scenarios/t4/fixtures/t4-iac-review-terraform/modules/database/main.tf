# Database resources

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Main application database
resource "aws_db_instance" "app" {
  identifier              = "${var.name_prefix}-app"
  engine                  = "postgres"
  engine_version          = "15.3"
  instance_class          = var.instance_class
  allocated_storage       = 100
  storage_type            = "gp3"
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.database.arn

  username = var.db_username
  password = var.db_password

  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  deletion_protection      = var.environment == "prod" ? true : false
  skip_final_snapshot      = var.environment == "prod" ? false : true
  publicly_accessible      = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-app-db"
  })
}

# New reporting database for analytics
resource "aws_db_instance" "reporting" {
  identifier              = "${var.name_prefix}-reporting"
  engine                  = "postgres"
  engine_version          = "15.3"
  instance_class          = "db.t3.small"
  allocated_storage       = 50
  storage_type            = "gp3"
  storage_encrypted       = false
  kms_key_id              = null

  username = "reporting_user"
  password = var.reporting_db_password

  vpc_security_group_ids = [aws_security_group.reporting_db.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  deletion_protection      = false
  skip_final_snapshot      = true
  publicly_accessible      = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-reporting-db"
  })
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-db-subnet-group"
  })
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db-sg"
  description = "Security group for main application database"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from application"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    cidr_blocks     = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-db-sg"
  })
}

# Security group for reporting database
resource "aws_security_group" "reporting_db" {
  name        = "${var.name_prefix}-reporting-db-sg"
  description = "Security group for reporting database"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from anywhere"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    cidr_blocks     = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-reporting-db-sg"
  })
}

resource "aws_kms_key" "database" {
  description             = "KMS key for database encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-db-key"
  })
}

resource "aws_kms_alias" "database" {
  name          = "alias/${var.name_prefix}-db-key"
  target_key_id = aws_kms_key.database.key_id
}

# Outputs
output "app_db_endpoint" {
  description = "Endpoint of the application database"
  value       = aws_db_instance.app.endpoint
}

output "app_db_host" {
  description = "Host of the application database"
  value       = split(":", aws_db_instance.app.endpoint)[0]
}

output "reporting_db_endpoint" {
  description = "Endpoint of the reporting database"
  value       = aws_db_instance.reporting.endpoint
}