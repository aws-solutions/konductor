# Logging and monitoring resources

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_cloudtrail" "audit" {
  name                          = "${var.name_prefix}-audit-trail"
  s3_bucket_name                = var.log_bucket_name
  s3_key_prefix                 = "cloudtrail"
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-audit-trail"
  })
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/aws/vpc/flow/${var.name_prefix}"
  retention_in_days = 90

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-vpc-flow-logs"
  })
}

resource "aws_flow_log" "vpc" {
  vpc_id               = var.vpc_id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.vpc_flow.arn

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-vpc-flow-log"
  })
}

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "${var.name_prefix}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "Alarm when CPU exceeds 80% for 10 minutes"
  alarm_actions       = var.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-high-cpu-alarm"
  })
}