# wallet-service

Wallet balances for the marketplace. `CHANGE.diff` is the pull request under review: it adds audit entries to
transfers, statement pages, CSV exports and notification retries.

- The service runs many requests at once; `store` is a network key-value store, so every `get` and `set` waits.
- Statement pages are 1-based in the API (`?page=1` is the first page).
- Export names come from the request query string.
- Notifications go through a mail provider that is sometimes down for minutes.
