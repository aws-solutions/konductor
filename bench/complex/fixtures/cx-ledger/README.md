# ledger-kit

Small building blocks for an account service. No dependencies.

## Modules

### `createLedger(initial)` in `src/ledger.js`

Keeps integer cent balances per account id. `transfer(from, to, cents)` moves money and returns `{ from, to, cents }`.
It throws for an amount that is not a positive integer, an unknown account (either side) or insufficient funds.
A failed transfer changes no balance. `balance(id)` and `total()` read the state.

### `createExports({ dir })` in `src/exports.js`

Statement files live in one export directory.
`readStatement(name)` resolves to the file's text. Names may point into subfolders of the directory; a name that points outside it is rejected.
`listStatements()` lists the `.csv` files at the top of the directory.

### `createRateCache({ fetchRates, clock, ttlMs })` in `src/rates.js`

Caches currency rates from `fetchRates()` (a promise of `{ CUR: rate }`).
`get(currency)` refreshes first when the cache is empty or at least `ttlMs` old (default 60000), then returns the rate.
`refresh()` rejects with the fetch error when `fetchRates` fails and leaves the cache and `updatedAt()` as they were; if `get` needs a refresh that fails, `get` rejects too.
An unknown currency throws `unknown currency: CUR`.

### `newCorrelationId()` in `src/ids.js`

An 8 character id for log lines. Not used for anything secret.

### `loadConfig(file)` in `src/config.js`

Reads a JSON file synchronously at startup and returns the parsed object.

Run the tests with `npm test`.
