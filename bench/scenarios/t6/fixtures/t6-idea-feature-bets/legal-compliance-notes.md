# Legal & Compliance Notes

**From:** Legal Team  
**To:** Product Team  
**Date:** June 1, 2025

## Export CSV Feature
### GDPR Considerations
- Customer IDs may be considered PII in some jurisdictions
- Need consent mechanism for export containing PII
- Right to be forgotten: must be able to delete exported data
- Data retention: exports should auto-expire after 30 days

### Compliance Requirements
- SOC 2: Need audit trail of who exported what
- HIPAA (if healthcare customers): Additional restrictions
- CCPA: Must honor "do not sell" requests

## Sales Notes Feature
### Data Protection
- Sales notes may contain sensitive deal information
- Need role-based access controls
- Encryption at rest required
- Client consent for storing conversation notes

### Record Keeping
- FINRA compliance for financial services customers
- Notes may be discoverable in litigation
- Need version history and edit logs

## Support Tickets Feature
### Privacy Considerations
- Support tickets often contain PII
- Must not expose other customers' tickets
- Need secure transmission to ticketing systems
- Data minimization: only send necessary info

### Service Level Agreements
- Ticket creation time affects SLA clocks
- Must maintain ticket status accuracy
- Integration failures could violate SLAs

## General Recommendations
1. Conduct DPIA (Data Protection Impact Assessment) for each feature
2. Consult with privacy team before implementation
3. Document data flows and retention policies
4. Build privacy by design into architecture