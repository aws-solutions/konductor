# Technical Review - IT Infrastructure

**Date:** December 18, 2023  
**Participants:** Alex (IT Director), Maria (Network Admin), David (Security), Mark (PM)  
**Purpose:** Assess technical feasibility of holds system

## Current Infrastructure

### LibraryWorld ILS (v7.2)
- Runs on Windows Server 2019
- Oracle 19c database
- SIP2 protocol for patron authentication
- API: Limited REST endpoints (read-only for most functions)
- Upgrade to v8.0 planned for Q3 2024 (may include better API)

### Network
- All branches connected via county fiber network
- Bandwidth: Central 1Gbps, others 100Mbps
- Wireless: Cisco Meraki across all locations
- VPN required for remote system access

### Security
- All systems require county domain authentication
- Data classification: PII (Personally Identifiable Information)
- Encryption required for data in transit and at rest
- Audit logging mandatory for all patron transactions

## Technical Constraints

### 1. Integration Points
- Must use SIP2 or SIP2 over HTTPS for real-time patron verification
- ILS API only provides availability data, not real-time updates
- Batch updates: 15-minute sync window acceptable
- No direct database access allowed (security policy)

### 2. Performance Requirements
- Support 500 concurrent users during peak hours
- Page load time under 3 seconds
- API response time under 1 second
- 99.5% uptime requirement

### 3. Data Storage
- Patron data must remain in ILS database
- Hold transaction data can be in separate system
- 18-month data retention required
- Daily backups to county data center

### 4. Mobile Considerations
- Responsive web design preferred over native apps
- Must work on iOS 14+ and Android 10+
- Offline functionality not required but nice-to-have
- Push notifications require separate infrastructure

## Open Questions
1. How to handle real-time availability updates?
2. Can we get write access to ILS API?
3. What about patrons using library computers (filtered internet)?
4. Disaster recovery requirements?

## Recommendations
1. Build separate holds database with periodic ILS sync
2. Use message queue for notification system
3. Implement caching layer for frequently accessed data
4. Consider cloud hosting for better scalability

## Next Steps
1. Schedule meeting with ILS vendor (January)
2. Draft technical architecture document
3. Estimate development effort
4. Identify potential vendors/partners

**Follow-up:** January 22, 2024