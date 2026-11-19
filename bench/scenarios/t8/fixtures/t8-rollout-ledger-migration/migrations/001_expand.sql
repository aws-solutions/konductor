-- Expand phase for the ledger 3.0 release.
ALTER TABLE ledger_entries ADD COLUMN settlement_route varchar(32) NULL;
CREATE INDEX CONCURRENTLY ledger_entries_settlement_route_idx ON ledger_entries (settlement_route);
