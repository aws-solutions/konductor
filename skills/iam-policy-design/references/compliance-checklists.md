# Compliance Checklists

Read this when the user or the design under review names a compliance framework (GDPR, HIPAA, PCI-DSS, SOC 2), or the design handles regulated data (PHI, cardholder data, personal data of people in the EU). `iam-policy-design` uses the checklists to design controls; `policy-validation` uses them, plus the checks and severity rules, to find gaps.

Each framework lists the controls to have in place, what a reviewer checks, and the citations to put on a finding.

## GDPR

**Controls:**

- **Data Encryption:** Personal data encrypted at rest (KMS), TLS 1.2+ in transit, key rotation enabled
- **Access Controls:** RBAC with least privilege, IAM policies restrict access, MFA for privileged accounts, regular access reviews
- **Audit Logging:** CloudTrail in all regions with log file validation, all access logged, logs encrypted, a retention period set and documented (GDPR sets no fixed period; storage limitation applies)
- **Data Deletion:** S3 lifecycle policies, DynamoDB TTL, manual deletion procedures, deletion verified
- **Data Residency:** Personal data stored in the regions the design chooses; any transfer outside the EU/EEA is documented and covered by an adequacy decision or SCCs (Articles 44-46); SCPs enforce the chosen regions
- **Data Portability:** Export APIs available, procedures documented, all personal data included
- **Privacy by Design:** Data minimization, purpose limitation, storage limitation

**Review checks:** Verify encryption at rest and in transit, least-privilege access with audit logging, deletion through S3 lifecycle policies or DynamoDB TTL, resources deployed only in the regions the design permits, and CloudTrail and service logs as evidence. Check that non-EU transfers have a documented legal basis. Flag as CRITICAL if personal data is unencrypted, there is no deletion path, or a non-EU transfer is undocumented.

**Citations:** Article 32 (security of processing, including encryption), Article 17 (right to erasure), Article 5(1)(e) (storage limitation), Article 44-46 (transfers).

## HIPAA

**Controls:**

- **PHI Protection:** PHI encrypted at rest with KMS (customer managed keys recommended when the design needs key-policy control or separation of duties), TLS 1.2+ in transit, HIPAA-eligible services only, access restricted
- **Access Controls:** RBAC with least privilege, MFA for PHI access, unique user IDs, auto logoff, quarterly access reviews
- **Audit Logging:** CloudTrail with log file validation, all PHI access logged, 6-year retention, logs encrypted, no PHI in CloudWatch Logs
- **BAA:** AWS BAA signed, BAA covers all services in use, BAAs with third parties
- **Data Backup:** Automated backups, backups encrypted, 6-year retention, DR procedures documented
- **Breach Notification:** Procedures documented, detection mechanisms (GuardDuty, Security Hub), 60-day notification timeline defined

**Review checks:** Verify PHI is encrypted at rest and in transit, MFA is enforced for PHI access, audit logging covers CloudTrail and service logs, and a BAA is signed with AWS. Check CloudWatch Logs for PHI. Flag as CRITICAL if PHI is unencrypted or found in logs.

**Citations:** Security Rule §164.312(a)(2)(iv) (encryption and decryption), §164.312(b) (audit controls), §164.308(a)(1)(ii)(D) (information system activity review).

## PCI-DSS

**Controls:**

- **Network Segmentation:** CDE in a separate VPC, security groups restrict traffic, NACLs for subnet controls, no direct internet access to the CDE
- **Encryption:** Cardholder data encrypted at rest (KMS), TLS 1.2+ in transit, strong cryptography (AES-256, RSA-2048), key management
- **Access Controls:** Least privilege, MFA for CDE access, unique user IDs, quarterly access reviews, default passwords changed
- **Logging:** CloudTrail with log file validation, all cardholder data access logged, 1-year retention, daily log review, automated alerting
- **Vulnerability Management:** Quarterly ASV scans, annual penetration testing, remediation process, patches within 30 days
- **File Integrity:** AWS Config rules, CloudWatch Events, automated alerts

**Review checks:** Verify VPC, subnets, and security groups separate the CDE, cardholder data is encrypted at rest and in transit, privileged access uses MFA, CloudTrail, VPC Flow Logs, and CloudWatch alarms are in place, and AWS Config rules and Security Hub checks cover vulnerability management. Flag as CRITICAL if cardholder data is unencrypted or segmentation is missing.

**Citations:** Requirement 1 (network segmentation), Requirement 3 (protecting stored cardholder data).

## SOC 2

**Controls:**

- **Access Controls (CC6):** Least privilege, MFA for privileged accounts, quarterly access reviews, unique user IDs, provisioning and deprovisioning
- **Encryption (CC6.7):** Data encrypted at rest (KMS), TLS 1.2+ in transit, key management documented
- **Monitoring (CC7):** CloudWatch monitoring, GuardDuty, Security Hub, automated alerting, 24/7 coverage
- **Audit Logging (CC7.2):** CloudTrail in all regions, comprehensive logging, 1-year retention, log integrity, restricted access
- **Change Management (CC8):** IaC for all changes, version control (Git), code review, automated testing, approval process
- **Incident Response (CC7.3):** Plan documented, team identified, annual testing, communication procedures
- **Business Continuity (A1.2):** Multi-AZ deployment, automated backups, DR procedures, annual DR testing

**Review checks:** Verify access controls, encryption, monitoring and alerting, and change management, and that incident response procedures are documented.

**Citations:** Trust Services Criteria CC6.1 (logical access), CC6.7 (encryption in transit).

## Example Gap Analysis Section

One filled framework block for the `policy-validation` report. Mark each control compliant, partial, or violated.

```markdown
### HIPAA Compliance

- PHI encryption: compliant (KMS customer managed key)
- PHI in logs: violated - PHI found in CloudWatch Logs
- BAA: compliant (signed with AWS)
- Audit log retention: partial - no 6-year retention set

**Remediation Priority**: Critical
**Estimated Effort**: 4-8 hours
**Regulatory Citations**: HIPAA Security Rule §164.312(a)(2)(iv) (encryption), §164.312(b) (audit controls)
```
