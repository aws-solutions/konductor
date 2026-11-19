# Orders Service

A lightweight order management service using SQLite with built-in migration support.

## Features

- Order repository with CRUD operations
- Rolling migration system for zero-downtime schema changes
- Order status tracking and reporting
- SQLite-based storage for simplicity

## Production Details

- **Database**: SQLite with file-based storage
- **Table size**: ~2.5 million rows in production (orders table)
- **Deployment strategy**: Rolling deployments with blue-green switching
- **Downtime tolerance**: Zero-downtime required for schema changes
- **Performance target**: 95% of API responses under 100ms

## Architecture

The service follows a repository pattern with separation between:
- Data access layer (`src/orders/repository.py`)
- Migration runner (`src/orders/migrate.py`)
- API layer (planned for future release)

## Development

```bash
# Run tests
python3 -m unittest discover -s tests

# Run migrations
python3 -m src.orders.migrate --direction up
```

## Migration Guidelines

When writing migrations:
1. Always provide `up` and `down` methods
2. Test both directions before deployment
3. Consider production table size when writing data migrations
4. Ensure backward compatibility during rolling deployments
5. Never drop columns without data preservation warnings