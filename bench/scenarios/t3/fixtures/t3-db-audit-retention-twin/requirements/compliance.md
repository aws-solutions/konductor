# Compliance Requirements

## Retention Policies

### Current Policy (Effective Q3 2024)
All audit logs must be retained for **400 days** to satisfy regulatory requirements from:
- PCI DSS v4.0 (Payment Card Industry)
- SOC 2 Type II controls
- GDPR Article 30 record-keeping

**Note**: This supersedes the previous 90-day retention policy documented in the legacy compliance manual.

### Data Protection
- Audit logs are considered PII (Personally Identifiable Information)
- Must support encryption at rest
- Access logs require special handling per data classification level 3

### Audit Requirements
- Immutable logging: Once written, records cannot be modified
- Tamper-evident design required
- Must support external auditor queries without performance degradation

### Query Requirements
Common queries that must be optimized:
1. User activity by user_id and time range
2. Failed authentication attempts by source IP
3. Administrative actions by resource type
4. Compliance reporting by date ranges

### Data Export
- Must support bulk export for legal discovery
- Export format: JSON Lines with metadata headers
- Maximum export size: 1TB per request