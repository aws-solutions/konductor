# Troubleshooting Guide

## Common Issues

### Deployment Failures

**Error: "Missing policy file"**
- Check all JSON files exist in `infra/buckets/`
- Verify file permissions
- Ensure no typos in file names

**Error: "Invalid JSON"**
- Run `npm run lint` to identify issues
- Use JSON validator tool
- Check for trailing commas

**Error: "Access Denied"**
- Verify AWS credentials
- Check IAM role permissions
- Confirm bucket ownership

### Access Issues

**CDN returns 403**
- Verify bucket policy allows CloudFront
- Check Origin Access Identity (OAI) configuration
- Confirm CloudFront distribution is deployed

**Direct S3 access works, CDN doesn't**
- Check CloudFront origin settings
- Verify cache behaviors
- Test with different file types

**Downloads failing**
- Check `downloads/private/` restrictions
- Verify bucket policy conditions
- Test with different user agents

### Logging Issues

**No logs appearing**
- Verify S3 bucket permissions for log delivery
- Check CloudFront logging configuration
- Confirm log prefix is correct

**Logs incomplete**
- Check S3 lifecycle policies
- Verify IAM permissions for log delivery
- Test with different time ranges

## Debugging Steps

1. **Check Policy Syntax**
   ```bash
   python3 -m json.tool infra/buckets/*.json
   ```

2. **Verify ARNs**
   ```bash
   node scripts/generate-arns.js
   ```

3. **Test Access**
   - Use AWS CLI to test S3 access
   - Test through CloudFront URL
   - Check CloudWatch metrics

4. **Review Logs**
   - Check S3 access logs
   - Review CloudFront logs
   - Monitor CloudTrail events

## Performance Issues

**Slow downloads**
- Check CloudFront cache hit ratio
- Verify S3 transfer acceleration
- Monitor network latency

**High latency**
- Check CloudFront edge locations
- Verify origin response time
- Monitor DNS resolution

## Security Issues

**Unauthorized access**
- Review bucket policies immediately
- Check IAM role assumptions
- Monitor CloudTrail for suspicious activity

**TLS/SSL errors**
- Verify certificate validity
- Check CloudFront SSL configuration
- Test with different browsers

## Contact Support

When contacting support, provide:
1. Error messages and timestamps
2. Affected environment (staging/production)
3. Steps to reproduce
4. Recent changes made
5. Log snippets (redact sensitive data)