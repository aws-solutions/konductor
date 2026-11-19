# EventFlow Database Architecture Project

## Project Context
EventFlow is a B2B ticketing platform that serves venues, promoters, and event organizers. We're designing the database architecture for multi-tenancy support.

## Key Documents
- `requirements.md` - Core functional and non-functional requirements
- `traffic-analysis.md` - Usage patterns and growth projections  
- `cost-analysis.md` - Budget constraints and cost calculations
- `operations.md` - Operational guidelines and limits
- `pricing.csv` - Cloud provider pricing sheet

## Project Goals
Design a database schema that:
1. Provides strong tenant isolation
2. Scales to 12,000+ tenants and 1.9+ billion rows
3. Stays within $600/month budget
4. Meets all performance and operational requirements

## Constraints to Consider
- Total storage budget: $600/month
- Maximum database connections: 1,000
- Row size: ~310 bytes including indexes
- Must support tenant reuse of human-readable keys

## Next Steps
Review all documents thoroughly before designing the schema. Pay close attention to numerical constraints scattered across different documents.