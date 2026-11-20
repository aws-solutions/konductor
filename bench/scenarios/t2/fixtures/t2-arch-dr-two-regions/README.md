# Design Review Packet: TicketBooking Active-Active Migration

## Overview
This packet contains the design document and supporting materials for migrating the TicketBooking service from single-region (us-east-1) to active-active across us-east-1 and us-west-2.

## Contents
- `docs/design/active-active-regions.md` - Main design document
- `data/replication-lag-measurements.csv` - Historical replication lag measurements
- `docs/service-targets.md` - Service level objectives and recovery targets
- `archives/previous-incident-2024-01.md` - Summary of previous regional outage
- `data/budget-breakdown.yaml` - Detailed cost breakdown
- `docs/glossary.md` - Terminology and acronyms
- `data/dns-config.json` - Current DNS configuration
- `docs/product-rules.md` - Business rules and constraints

## Purpose
This design is ready for architecture review. Please evaluate the technical approach, identify risks, and verify that all requirements are addressed.

## Timeline
- Design review period: March 18-22, 2024
- Target implementation start: April 1, 2024
- Production deployment: May 15, 2024

## Reviewers
- Platform Architecture Team (primary)
- Site Reliability Engineering
- Product Engineering
- Security Team

## Contact
For questions about this design, contact the Architecture Team at arch-team@example.com.

---
*Packet prepared by: Platform Engineering*
*Date: 2024-03-14*