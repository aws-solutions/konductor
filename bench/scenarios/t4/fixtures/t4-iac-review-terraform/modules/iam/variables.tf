variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "db_secret_arn" {
  description = "ARN of the database secret"
  type        = string
}

variable "log_bucket_arn" {
  description = "ARN of the S3 log bucket"
  type        = string
}

variable "exports_bucket_arn" {
  description = "ARN of the S3 exports bucket"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}