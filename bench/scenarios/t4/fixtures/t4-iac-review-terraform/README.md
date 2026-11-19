# WebApp Infrastructure

Terraform infrastructure for the WebApp project.

## Architecture

The infrastructure consists of:

- **VPC** with public and private subnets across 2 AZs
- **RDS PostgreSQL** for main application database
- **ECS Fargate** for containerized application
- **Application Load Balancer** with HTTPS
- **S3 buckets** for data, logs, and static assets
- **CloudTrail** for audit logging
- **CloudWatch** for monitoring and alarms

## Environments

- `staging`: Development environment with smaller resources
- `prod`: Production environment with high availability

## Getting Started

1. Install Terraform >= 1.5
2. Configure AWS credentials
3. Initialize: `terraform init`
4. Plan: `terraform plan -var-file=environments/staging/terraform.tfvars`
5. Apply: `terraform apply -var-file=environments/staging/terraform.tfvars`

## Module Structure

- `modules/network`: VPC, subnets, route tables
- `modules/storage`: S3 buckets
- `modules/database`: RDS instances, security groups
- `modules/compute`: ECS, ALB, security groups
- `modules/iam`: IAM roles and policies
- `modules/logging`: CloudTrail, CloudWatch, flow logs

## Secrets Management

Database passwords are stored in AWS Secrets Manager. The terraform variables `db_password` and `reporting_db_password` should be provided via environment variables or secrets.

## CI/CD

GitHub Actions workflow runs on PRs:
- Terraform fmt validation
- Terraform validate
- Terraform plan

## Reporting Feature

The new reporting feature adds:
- Reporting RDS database for analytics
- Exports S3 bucket for CSV reports
- Separate IAM role for reporting tasks
- Additional CloudWatch metrics

See `docs/reporting.md` for details.