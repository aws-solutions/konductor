-- Prepare compatibility data before application traffic moves.
UPDATE ledger_entries
SET settlement_code = 'standard'
WHERE settlement_code IS NULL;

-- Verify before continuing:
-- SELECT count(*) FROM ledger_entries WHERE settlement_code IS NULL;
