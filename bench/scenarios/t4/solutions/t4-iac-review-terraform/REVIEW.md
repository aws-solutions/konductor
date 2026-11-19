# Security Review: PR #142 - Reporting Feature

## Summary
This PR adds reporting capabilities to our infrastructure. While the feature is valuable, several security issues need to be addressed before merging.

## Findings

### Critical Issues

**1. Plaintext Database Password in Variables**
- **File**: `variables.tf`
- **Line**: ~52-56
- **Severity**: Critical
- **Issue**: Database password (`db_password`) is defined with a plaintext default value (`"TempPass123!"`). This exposes credentials in version control.
- **Fix**: Remove default value, mark variable as sensitive, and use AWS Secrets Manager or SSM Parameter Store. Pass via environment variables or CI/CD secrets.

**2. Publicly Accessible Reporting Database**
- **File**: `modules/database/main.tf`
- **Line**: ~35-55
- **Severity**: Critical
- **Issue**: Reporting RDS instance has `publicly_accessible = true` and security group opening port 5432 to `0.0.0.0/0`. This exposes database to the entire internet.
- **Fix**: Set `publicly_accessible = false`, update security group to allow access only from application subnets or specific IP ranges.

### High Issues

**3. Unencrypted Reporting Database**
- **File**: `modules/database/main.tf`
- **Line**: ~40
- **Severity**: High
- **Issue**: Reporting database has `storage_encrypted = false` and no KMS key specified. Data at rest is not encrypted.
- **Fix**: Set `storage_encrypted = true` and specify `kms_key_id` using the existing KMS key or create a dedicated one.

**4. Overly Permissive IAM Policy**
- **File**: `modules/iam/main.tf`
- **Line**: ~65-75
- **Severity**: High
- **Issue**: Reporting task IAM policy grants `Action = "*"` on `Resource = "*"`. This provides full AWS access to the reporting task.
- **Fix**: Create scoped policy with least privilege. Only grant necessary permissions for S3 write, database access, and logging.

**5. Open PostgreSQL Port in Security Group**
- **File**: `modules/database/main.tf`
- **Line**: ~95-105
- **Severity**: High
- **Issue**: Security group `aws_security_group.reporting_db` allows inbound traffic on port 5432 from `0.0.0.0/0`.
- **Fix**: Restrict to VPC CIDR (`10.0.0.0/16`) or application security group.

**6. KMS Key with External Account Access**
- **File**: `main.tf`
- **Line**: ~175-195
- **Severity**: High
- **Issue**: KMS key policy grants `kms:*` to external AWS account (`999999999999`) and has `enable_key_rotation = false`.
- **Fix**: Remove external account access unless required, enable key rotation. Use conditional statements for cross-account access.

### Medium Issues

**7. Public S3 Export Bucket**
- **File**: `modules/storage/main.tf`
- **Line**: ~25-50
- **Severity**: Medium
- **Issue**: Exports bucket has public ACL (`public-read-write`) and bucket policy allowing `Principal = "*"` for GetObject and PutObject.
- **Fix**: Remove public ACL, use pre-signed URLs or IAM roles for controlled access. Add S3 Block Public Access settings.

**8. Single-Region CloudTrail**
- **File**: `modules/logging/main.tf`
- **Line**: ~10-15
- **Severity**: Medium
- **Issue**: CloudTrail configured with `is_multi_region_trail = false` and `enable_log_file_validation = false`.
- **Fix**: Set `is_multi_region_trail = true` and `enable_log_file_validation = true` for comprehensive audit logging and integrity checking.

### Low Issues

**9. Plaintext Reporting Database Password**
- **File**: `variables.tf`
- **Line**: ~60
- **Severity**: Low
- **Issue**: Reporting database password also has plaintext default.
- **Fix**: Same as issue #1 - use secrets management.

**10. Static Website Bucket Configuration**
- **File**: `modules/storage/main.tf`
- **Line**: ~55-75
- **Severity**: Low
- **Note**: Static website bucket is intentionally public for CDN serving. This is acceptable but should be documented.

**11. Load Balancer Port 443**
- **File**: `modules/compute/main.tf`
- **Line**: ~135-145
- **Severity**: Info
- **Note**: Load balancer opening port 443 to `0.0.0.0/0` is expected for public web application.

**12. Log Shipping IAM Policy**
- **File**: `modules/iam/main.tf`
- **Line**: ~85-105
- **Severity**: Info
- **Note**: Wildcard resource for read-only log operations (`logs:Describe*`, `logs:Get*`) is acceptable for this use case.

## Recommendations

1. **Before Merge**:
   - Fix critical issues #1 and #2
   - Address high severity issues #3-6

2. **Follow-up Tasks**:
   - Implement proper secrets management
   - Add S3 Block Public Access configuration
   - Consider adding WAF for load balancer
   - Implement database backup and retention policies

3. **Testing**:
   - Verify security group changes don't break connectivity
   - Test IAM policy permissions
   - Validate encryption configuration

The reporting feature is architecturally sound but requires security hardening before production deployment.

```json
[
  {
    "file": "variables.tf",
    "line": 52,
    "severity": "critical",
    "issue": "Plaintext database password in variable default",
    "fix": "Remove default value, use sensitive flag, store in Secrets Manager"
  },
  {
    "file": "modules/database/main.tf",
    "line": 45,
    "severity": "critical",
    "issue": "Reporting database publicly accessible to internet",
    "fix": "Set publicly_accessible = false, restrict security group to VPC"
  },
  {
    "file": "modules/database/main.tf",
    "line": 40,
    "severity": "high",
    "issue": "Reporting database storage not encrypted",
    "fix": "Set storage_encrypted = true, specify kms_key_id"
  },
  {
    "file": "modules/iam/main.tf",
    "line": 70,
    "severity": "high",
    "issue": "IAM policy with Action '*' granting full AWS access",
    "fix": "Create scoped policy with least privilege permissions"
  },
  {
    "file": "modules/database/main.tf",
    "line": 100,
    "severity": "high",
    "issue": "Security group allows PostgreSQL port 5432 from 0.0.0.0/0",
    "fix": "Restrict to VPC CIDR or specific security groups"
  },
  {
    "file": "main.tf",
    "line": 180,
    "severity": "high",
    "issue": "KMS key allows external account access and rotation disabled",
    "fix": "Remove external account unless required, enable key rotation"
  },
  {
    "file": "modules/storage/main.tf",
    "line": 30,
    "severity": "medium",
    "issue": "S3 exports bucket has public ACL and policy",
    "fix": "Remove public ACL, use pre-signed URLs, add block public access"
  },
  {
    "file": "modules/logging/main.tf",
    "line": 12,
    "severity": "medium",
    "issue": "CloudTrail single-region with log validation disabled",
    "fix": "Enable multi-region trail and log file validation"
  },
  {
    "file": "variables.tf",
    "line": 60,
    "severity": "low",
    "issue": "Plaintext reporting database password",
    "fix": "Use secrets management solution"
  },
  {
    "file": "modules/storage/main.tf",
    "line": 60,
    "severity": "low",
    "issue": "Static website bucket public for CDN (intended)",
    "fix": "No fix needed - document as intentional"
  },
  {
    "file": "modules/compute/main.tf",
    "line": 140,
    "severity": "info",
    "issue": "Load balancer port 443 open to internet (expected)",
    "fix": "No fix needed - public web application requirement"
  },
  {
    "file": "modules/iam/main.tf",
    "line": 95,
    "severity": "info",
    "issue": "Wildcard resource for read-only log operations",
    "fix": "No fix needed - acceptable for log shipping"
  }
]
```