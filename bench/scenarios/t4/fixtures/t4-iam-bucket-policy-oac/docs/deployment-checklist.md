# Deployment Checklist

## Pre-Deployment
- [ ] Run all tests: `npm test`
- [ ] Verify JSON files: `npm run lint`
- [ ] Check bucket names match config
- [ ] Review policy changes
- [ ] Confirm environment (staging/production)

## Deployment Steps
1. **Update Bucket Policies**
   - Apply new policies to S3 buckets
   - Verify policies are valid JSON
   - Test access with deploy role

2. **Upload Assets**
   - Sync files to assets bucket
   - Verify file permissions
   - Check Content-Type headers

3. **Upload Downloads**
   - Sync files to downloads bucket
   - Verify private/ directory restrictions
   - Test download links

4. **Configure CloudFront**
   - Update origin settings if needed
   - Verify cache behaviors
   - Check error pages

5. **Invalidate Cache**
   - Create CloudFront invalidation
   - Specify paths or use wildcard
   - Monitor invalidation status

## Post-Deployment
- [ ] Test CDN access
- [ ] Verify HTTPS enforcement
- [ ] Check logs are being written
- [ ] Test private downloads restriction
- [ ] Monitor for errors

## Rollback Plan
If issues occur:
1. Revert bucket policies to previous version
2. Remove new assets if causing issues
3. Create CloudFront invalidation
4. Verify original functionality restored

## Emergency Contacts
- Platform Team: platform@example.com
- Security Team: security@example.com
- On-call Engineer: ops@example.com