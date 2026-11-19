# Technical Debt & Infrastructure Notes

## Known Issues
1. Current authentication system needs upgrade for multi-tenant support
2. Payment processing integration tests are flaky
3. Database schema needs normalization for audit requirements

## Infrastructure Requirements
- Need separate environments: dev, staging, prod
- Compliance reporting requires 7-year data retention
- Audit trail must capture all user actions

## Security Considerations
- Two-factor authentication desired but not required for MVP
- Data encryption at rest and in transit
- Regular security scans required

## Performance Targets
- 99.9% uptime for payment processing
- < 2 second page load times
- Support for 500 concurrent users