# Pocket Ledger

Pocket Ledger is a small wallet ledger service used by the account portal. It keeps account balances in integer minor units and records every movement in a journal.

## Local checks

This project has no runtime dependencies. Use Node.js 24 or newer, then run:

```sh
node --test
```

The reconciliation command reads the configured store and reports accounts whose balance does not match their journal entries. The scheduled transfer worker is invoked by the platform timer and uses the same transfer rules as the HTTP service. Schedule configuration is kept separate from account seed data.

## Layout

- `src/` contains the ledger and worker code.
- `config/` contains deployment-neutral limits and schedules.
- `docs/` records operational and accounting rules.
