# QA Test Plan - MVP Scope

## Testing Scope
**In Scope for MVP:**
- User authentication and login flows
- Tenant profile creation and management
- Maintenance request submission and basic tracking
- Rent payment processing (happy path)
- Property manager dashboard (basic view)
- Compliance reporting generation

**Out of Scope for MVP:**
- Advanced search functionality
- Bulk operations
- Third-party integrations beyond Stripe
- Advanced analytics
- Mobile app

## Test Environments
- Development: Continuous testing
- Staging: Full regression before prod
- Production: Smoke tests only

## Testing Schedule
- Sprint 1-2: Unit and integration tests
- Sprint 3-5: Feature testing
- Sprint 6: Integration testing
- Sprint 7: User acceptance testing

## Risks & Constraints
- QA env unavailable Mar 3-7
- Limited time for full regression
- Focus on critical path functionality