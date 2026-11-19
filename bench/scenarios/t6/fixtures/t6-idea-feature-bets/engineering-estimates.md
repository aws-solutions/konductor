# Engineering Estimates - Feature Development

**From:** Samir Patel, Engineering Lead  
**Date:** June 8, 2025

## Export CSV with Customer IDs
**Effort:** 3-4 weeks (2 engineers)
**Components:**
- Export API enhancement (1.5 weeks)
- UI for column selection (1 week)
- Testing & security review (1 week)
- Documentation (0.5 weeks)

**Technical Notes:**
- Need to join customer data with calendar events
- Performance impact on large exports
- GDPR: must exclude PII unless explicitly included

## Sales Notes Feature
**Effort:** 4-5 weeks (2 engineers)  
**Components:**
- Rich text editor integration (2 weeks)
- Sync architecture (1.5 weeks)
- Permissions system (1 week)
- Mobile support (0.5 weeks)

**Technical Notes:**
- Storage: notes need version history
- Search across notes required
- Offline support would add 2 weeks

## Support Tickets Integration
**Effort:** 5-6 weeks (2 engineers)
**Components:**
- Support system API integration (2.5 weeks)
- Ticket creation UI (1.5 weeks)
- Status sync & notifications (1.5 weeks)
- Testing with real systems (0.5 weeks)

**Technical Notes:**
- Multiple support systems (Zendesk, Freshdesk, etc.)
- Webhook handling for status updates
- Error handling for failed integrations

## Dependencies
All features require backend and frontend work. Support tickets is most complex due to external integrations.