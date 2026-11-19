# ShopFast Order History Database

## Project Status
**Phase**: Architecture Design  
**Next Milestone**: Schema finalization and storage sizing  
**Due Date**: 2024-02-15

## Overview
This repository contains design documents and specifications for the new ShopFast order history database. The database will replace the legacy PostgreSQL-based system with a SQLite solution optimized for read-heavy query patterns.

## Directory Structure
```
├── requirements.md          # Business and technical requirements
├── traffic-analysis.md      # Usage patterns and performance requirements
├── pricing-guide.md         # Cloud storage pricing and budget
├── pricing.csv             # Machine-readable price list
├── existing-schema.sql      # Legacy schema (for reference)
├── query-patterns.sql       # Sample queries for each access pattern
├── prototype-results.md     # Results from prototype testing
└── constraints.txt          # Hard constraints and limits
```

## Quick Reference

### Key Numbers
- **Order lines**: 900 million
- **Row size**: ~2.5 KB
- **Base data**: 2.05 TB
- **Storage limit**: 2.5 TB (Standard volume)
- **Monthly budget**: $300

### Critical Constraints
1. Must use SQLite for operational consistency
2. Total storage cannot exceed 2.5 TB
3. P99 read latency < 100ms for customer queries
4. Must support all 7 query patterns in requirements

### Design Options Under Consideration
1. **Option A**: Single table with comprehensive indexes
2. **Option B**: Two tables (orders + order_lines) with foreign key
3. **Option C**: Denormalized single table with minimal indexes
4. **Option D**: Partitioned by date with separate tables

### Next Steps
1. Finalize schema design
2. Calculate exact storage requirements for each option
3. Validate performance with EXPLAIN QUERY PLAN
4. Create implementation plan

## Development Environment
- SQLite 3.45+ required for latest features
- Test database: 1% sample (9 million rows) provided
- Performance testing: Use `EXPLAIN QUERY PLAN` to validate index usage

## Testing Requirements
All schema designs must be validated with:
1. Correct primary and foreign key constraints
2. All `NOT NULL` constraints where applicable
3. Unique constraint on `order_number`
4. No full table scans on large tables (must use index search)
5. Storage calculations within 2.5 TB limit

## Contact
- **Product Owner**: Alex Chen
- **Database Architect**: Sam Rivera  
- **Performance Lead**: Jordan Kim

## Changelog
- **2024-01-15**: Initial repository setup
- **2024-01-20**: Added requirements and traffic analysis
- **2024-01-25**: Updated with pricing information
- **2024-01-28**: Added prototype test results