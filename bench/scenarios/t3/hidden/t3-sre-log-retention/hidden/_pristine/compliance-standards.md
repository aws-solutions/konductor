# Compliance Standards Reference

## Regulatory Requirements

### Financial Regulations (FINRA/SEC)
- **FINRA Rule 4511**: Requires retention of certain records for 6 years
- **SEC Rule 17a-4(f)**: Requires retention of electronic records for 3-6 years
- **SEC Rule 204-2**: Investment advisers must retain records for 5 years

### Data Protection (GDPR/CCPA)
- **GDPR Article 30**: Requires records of processing activities
- **CCPA**: Requires data access logs for 12 months
- **HIPAA**: 6-year retention for certain healthcare records

### Industry Standards
- **PCI DSS**: 1 year retention for security event logs
- **ISO 27001**: Requires defined retention periods
- **SOC 2**: Requires evidence of security controls

## Our Compliance Framework

### Retention Periods by Data Type
| Data Type | Minimum Retention | Regulatory Basis | Notes |
|-----------|-------------------|------------------|-------|
| Application Logs | 365 days | GDPR Article 30, PCI DSS | Current requirement |
| Audit Logs | 365 days | SOC 2, ISO 27001 | Security compliance |
| Access Logs | 365 days | CCPA, GDPR | Privacy compliance |
| Performance Metrics | 90 days | Operational | Reduced requirement |
| Debug Logs | 30 days | Operational | Development only |

### Search Requirements
- **Audit Trails**: Must be searchable within reasonable time for investigations
- **Legal Holds**: Must support immediate preservation of relevant data
- **Data Subject Requests**: Must support retrieval of individual data within 30 days

### Data Protection
- **Encryption**: At rest and in transit for all compliance data
- **Access Controls**: Role-based access with audit logging
- **Integrity**: Tamper-evident storage for audit trails
- **Backup**: Regular backups with geographic distribution

## Implementation Notes

### Current Environment
- **Production**: 24 TB/day ingestion, 365-day retention required
- **Staging**: 2.4 TB/day ingestion, 90-day retention (testing only)
- **Development**: 240 GB/day, 30-day retention

**Important**: The 2.4 TB/day figure mentioned in some planning documents is from our staging environment, not production. Production requirements are 24 TB/day as measured over the last quarter.

### Validation Requirements
- Monthly compliance reports must be generated
- Annual third-party audit required
- Regular testing of data retrieval processes
- Documentation of retention policies and procedures

### Risk Assessment
- **High Risk**: Failure to retain required data (regulatory fines)
- **Medium Risk**: Inability to retrieve data within required timeframes
- **Low Risk**: Storage costs exceeding budget