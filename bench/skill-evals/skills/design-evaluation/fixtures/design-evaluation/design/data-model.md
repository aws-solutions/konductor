# Data Model

## Exports table

- PK: `exportId` (UUID)
- Attributes: `tenantId`, `month`, `status`, `s3Key`, `createdAt`
- No secondary indexes.

## Access patterns

| # | Pattern | Served by |
|---|---------|-----------|
| AP1 | Get export by id | GetItem on exportId |
| AP2 | List a tenant's exports, newest first (tenant export history page) | TBD |
| AP3 | Find exports stuck in QUEUED for more than 1 hour (ops sweeper) | TBD |
