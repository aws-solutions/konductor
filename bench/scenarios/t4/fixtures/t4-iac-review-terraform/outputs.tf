output "vpc_id" {
  description = "ID of the VPC"
  value       = module.network.vpc_id
}

output "app_url" {
  description = "URL of the application"
  value       = "https://${module.compute.lb_dns_name}"
}

output "app_db_endpoint" {
  description = "Endpoint of the application database"
  value       = module.database.app_db_endpoint
}

output "reporting_db_endpoint" {
  description = "Endpoint of the reporting database"
  value       = module.database.reporting_db_endpoint
}

output "static_website_url" {
  description = "URL of the static website bucket"
  value       = module.storage.static_website_url
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.compute.ecs_cluster_name
}