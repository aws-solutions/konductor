# S3 storage resources

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_s3_bucket" "data" {
  bucket = "${var.name_prefix}-data"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-data"
  })
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Reporting exports bucket - stores CSV reports for external systems
resource "aws_s3_bucket" "exports" {
  bucket = "${var.name_prefix}-exports"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-exports"
  })
}

resource "aws_s3_bucket_acl" "exports" {
  bucket = aws_s3_bucket.exports.id
  acl    = "public-read-write"
}

# Allow external services to read reports
resource "aws_s3_bucket_policy" "exports" {
  bucket = aws_s3_bucket.exports.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowPublicRead"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.exports.arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket" "static_website" {
  bucket = "${var.name_prefix}-static"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-static"
    Purpose = "Static website behind CDN"
  })
}

resource "aws_s3_bucket_acl" "static_website" {
  bucket = aws_s3_bucket.static_website.id
  acl    = "public-read"
}

resource "aws_s3_bucket_website_configuration" "static_website" {
  bucket = aws_s3_bucket.static_website.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}

# Bucket for logs
resource "aws_s3_bucket" "logs" {
  bucket = "${var.name_prefix}-logs"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-logs"
  })
}

# Block public access for log bucket
resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}