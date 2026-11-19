variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "reporting_task_role_arn" {
  description = "ARN of the reporting task IAM role"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# Outputs
output "exports_bucket_name" {
  description = "Name of the exports bucket"
  value       = aws_s3_bucket.exports.bucket
}

output "exports_bucket_arn" {
  description = "ARN of the exports bucket"
  value       = aws_s3_bucket.exports.arn
}

output "static_website_url" {
  description = "URL of the static website bucket"
  value       = aws_s3_bucket_website_configuration.static_website.website_endpoint
}

output "logs_bucket_name" {
  description = "Name of the logs bucket"
  value       = aws_s3_bucket.logs.bucket
}