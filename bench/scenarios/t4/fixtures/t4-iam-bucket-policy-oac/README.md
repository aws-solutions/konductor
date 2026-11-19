# Marketing & Downloads Site Infrastructure

This repository contains infrastructure code, deployment scripts, and documentation for our marketing site and customer downloads platform.

## Overview

The site consists of:
- **Marketing assets** (images, CSS, JS) in S3 buckets
- **Customer downloads** (software, documentation) in separate S3 buckets  
- **CloudFront CDN** for content delivery
- **Access logs** in S3 buckets

## Directory Structure

```
├── infra/                    # Infrastructure configuration
│   ├── buckets/             # S3 bucket policies
│   ├── iam/                 # IAM policies and roles
│   └── cdn-config.json      # CloudFront configuration
├── deploy/                  # Deployment scripts
├── scripts/                 # Utility scripts
├── test/                   # Tests
├── docs/                   # Documentation
└── package.json            # Node.js project configuration
```

## Deployment

### Prerequisites
- Node.js 24 or later
- AWS credentials configured

### Commands

```bash
# Run tests
npm test

# Lint JSON files
npm run lint

# Deploy to staging
npm run deploy:staging

# Deploy to production  
npm run deploy:prod
```

## Environments

- **Staging**: `assets-bucket-staging`, `downloads-bucket-staging`, `logs-bucket-staging`
- **Production**: `assets-bucket-prod`, `downloads-bucket-prod`, `logs-bucket-prod`

## CDN Configuration

CloudFront distributions are configured in `infra/cdn-config.json`:
- Staging distribution ID: `E1A2B3C4D5E6F7`
- Production distribution ID: `F8E7D6C5B4A3F2`

## Security Notes

Currently:
- Downloads bucket allows public GetObject access
- Assets bucket allows public ListBucket and GetObject access  
- Logs bucket allows any principal in the account to write
- No TLS enforcement on buckets

## Development

When making changes to bucket policies:
1. Update the policy JSON files in `infra/buckets/`
2. Run tests: `npm test`
3. Deploy to staging first: `npm run deploy:staging`
4. Verify functionality
5. Deploy to production: `npm run deploy:prod`

## Troubleshooting

If deployment fails:
1. Check AWS credentials are valid
2. Verify bucket names in `infra/cdn-config.json`
3. Ensure policy files are valid JSON
4. Check CloudFront distribution IDs match actual distributions