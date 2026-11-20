# GlobalSaaS Platform Documentation

This directory contains documentation for the GlobalSaaS enterprise CRM platform.

## File Structure

- `requirements.md` - Business and technical requirements
- `traffic-analysis.md` - Performance metrics and traffic analysis
- `cost-analysis.md` - Financial analysis and constraints
- `pricing-data.json` - Infrastructure pricing data
- `technical-constraints.md` - Technical implementation limits
- `current-architecture.md` - Current system architecture

## Key Documents to Review

### For Disaster Recovery Planning
1. **Requirements Document** - Contains RPO (5 minutes) and RTO (45 minutes) objectives
2. **Traffic Analysis** - Includes database restore time data (57 minutes with current constraints)
3. **Cost Analysis** - Details $12,000 monthly budget constraint
4. **Technical Constraints** - Specifies restore throughput limits (2 streams at 1.2 GB/s each)

### Recent Changes
- 2024-01-15: Updated RTO requirement from 60 to 45 minutes in requirements.md
- 2024-01-20: Added restore throughput constraints in technical-constraints.md
- 2024-01-31: Updated pricing data with AWS December 2023 reductions

## Decision Context

The platform team is evaluating disaster recovery options to meet tightened RTO requirements while staying within budget. Three options are being considered:

1. **Nightly Backup Copy** - Cost-effective but with higher RPO/RTO
2. **Pilot Light with Continuous Replication** - Current implementation, meets RPO but exceeds RTO
3. **Warm Standby** - Higher cost option with better recovery characteristics

## How to Use This Documentation

When evaluating DR options:
1. Cross-reference numbers across documents (some metrics appear in multiple places)
2. Verify calculations using the provided constraints
3. Check for any superseded or outdated numbers (marked as such)
4. Ensure all business requirements are met

## Contact
For questions about this documentation, contact the Platform Architecture Team.

---

*Documentation last updated: 2024-01-31*