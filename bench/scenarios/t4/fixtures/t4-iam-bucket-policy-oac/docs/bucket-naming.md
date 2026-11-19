# Bucket Naming Convention

## Pattern
`<purpose>-bucket-<environment>`

## Purpose Codes
- `assets`: Marketing assets (CSS, JS, images)
- `downloads`: Customer downloads (software, documentation)
- `logs`: Access logs from CloudFront and S3

## Environments
- `staging`: Pre-production testing
- `prod`: Production live traffic

## Examples
- `assets-bucket-staging`
- `downloads-bucket-prod`
- `logs-bucket-staging`

## Rules
1. Lowercase only
2. Hyphens as separators
3. No underscores
4. 3-63 characters
5. DNS-compliant names

## Rationale
- Consistent naming across environments
- Easy to identify purpose from name
- Compatible with AWS naming rules
- Works with CloudFront origins