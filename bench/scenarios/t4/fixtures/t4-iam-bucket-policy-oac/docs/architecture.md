# Architecture Overview

## System Components

### 1. Storage Layer (S3)
- **Assets Bucket**: Static marketing content (CSS, JS, images)
- **Downloads Bucket**: Customer-facing downloads (software, PDFs)
- **Logs Bucket**: Access logs from CloudFront and S3

### 2. Content Delivery (CloudFront)
Two CloudFront distributions:
- **Staging**: For testing and pre-production
- **Production**: For live customer traffic

### 3. Access Control (IAM)
- **Deploy Role**: Service role for deployment automation
- **Bucket Policies**: Resource-based policies on S3 buckets

## Data Flow

```
Internet User → CloudFront CDN → S3 Buckets
                     ↓
                Access Logs → S3 Logs Bucket
```

## Security Model

### Current State
- Public read access to assets and downloads
- Account-wide write access to logs
- No transport layer security enforcement

### Desired State
- CDN-only access to content
- Principle of least privilege
- TLS requirement for all access

## Deployment Process

1. **Asset Upload**: Deploy role uploads files to S3
2. **Policy Application**: Bucket policies updated
3. **Cache Invalidation**: CloudFront cache cleared
4. **Verification**: Access tested through CDN

## Monitoring & Logging

- CloudFront access logs delivered to S3
- S3 server access logging enabled
- Log retention: 90 days
- Log prefix: `cloudfront-logs/` for CloudFront, `s3-access-logs/` for S3

## Recovery Procedures

### Bucket Corruption
1. Restore from versioned objects (if enabled)
2. Redeploy from source artifacts
3. Update policies if needed

### CDN Issues  
1. Check CloudFront distribution status
2. Verify origin access identity
3. Test direct S3 access (temporarily)

### Access Issues
1. Verify bucket policies
2. Check IAM permissions
3. Test with different principals