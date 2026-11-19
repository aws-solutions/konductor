# Changelog

All notable changes to this infrastructure will be documented in this file.

## [Unreleased]

### Added
- Reporting database for analytics
- Export S3 bucket for CSV reports
- Static website S3 bucket
- Reporting IAM role and policy
- CloudWatch metrics for reporting
- Documentation for reporting feature

### Changed
- Updated main.tf to include reporting components
- Updated outputs.tf with new endpoints
- Updated README with reporting details

### Fixed
- Security group rules for database access
- IAM policy permissions for application tasks
- Terraform variable validation

## [1.0.0] - 2024-01-15

### Added
- Initial infrastructure deployment
- VPC with public and private subnets
- RDS PostgreSQL database
- ECS Fargate cluster
- Application Load Balancer
- S3 buckets for data and logs
- IAM roles and policies
- CloudTrail audit logging
- CloudWatch monitoring
- CI/CD pipeline with GitHub Actions
- Complete documentation

### Security
- Database encryption with KMS
- S3 bucket encryption
- Least privilege IAM policies
- Security groups with minimal rules
- Secrets Manager for credentials