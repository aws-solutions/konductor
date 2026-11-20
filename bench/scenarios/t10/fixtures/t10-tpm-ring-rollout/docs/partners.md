# Consumer compatibility

The Ledger Lantern team consumes the legacy receipt envelope from Harbor Receipts. Their migration is scheduled to finish on 2025-09-30, and they need the old envelope available through that date. The rendering service may add a new document beside the old one, but removing the old generator before the migration completes would break their reconciliation batch.

The fulfillment team owns delivery retries. The account portal owns its own download presentation and does not consume renderer internals.
