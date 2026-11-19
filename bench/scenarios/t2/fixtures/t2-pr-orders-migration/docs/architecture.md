# Architecture Overview

## Database Schema

### Orders Table
- `id`: INTEGER PRIMARY KEY
- `customer_id`: INTEGER NOT NULL
- `amount`: DECIMAL(10,2) NOT NULL
- `status`: VARCHAR(20) NOT NULL (pending, processing, shipped, cancelled)
- `created_at`: TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

### Production Scale
- Approximately 2.5 million rows in production
- 95% of queries should use indexes
- Full table scans should be avoided
- Migrations affecting >100k rows should be batched

## Migration System

### Design Principles
1. **Zero-downtime**: Old and new code must run together during rolling deployments
2. **Reversibility**: Every migration must have a working `down` method
3. **Safety**: Large data migrations must be batched to avoid locking
4. **Compatibility**: Schema changes must maintain backward compatibility

### Implementation Details
- Migration files are versioned and applied in order
- Each migration has `up()` and `down()` methods
- Migration state is tracked in a separate `schema_migrations` table
- The migration runner ensures only one migration runs at a time

## Repository Pattern

The service uses a repository pattern to abstract database operations:
- `OrderRepository`: Main data access interface
- `OrderReportRepository`: Specialized reporting queries
- `MigrationRepository`: Internal migration state management

All repositories use parameterized queries to prevent SQL injection.