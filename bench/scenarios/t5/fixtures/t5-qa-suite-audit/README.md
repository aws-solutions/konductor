# LedgerLane billing

LedgerLane is a deliberately small CommonJS billing core. It creates invoices, calculates plan changes, records ledger entries, and translates payment and webhook integrations into plain objects. The `src/api.js` module exposes a small HTTP-free request handler for jobs and command-line tools.

## Running it

Node.js 24 is required. There are no runtime dependencies.

```sh
npm test
```

Plans and money are represented in integer cents. Dates exchanged with the service use ISO calendar dates. Payment providers and tax systems are passed in as adapters so the core can be run without network access.

The repository is maintained by the subscriptions team. Release notes live in `CHANGELOG.md`; operational notes are in `docs/`.
