-- Contract phase. Run only after every application host is on ledger-api 3.0.
ALTER TABLE ledger_entries DROP COLUMN settlement_code;
DROP INDEX CONCURRENTLY IF EXISTS ledger_entries_settlement_route_idx;
