# Ledgerlight

Ledgerlight is a deliberately small billing library for applications that keep money as integer minor units. It includes currencies, invoices, a ledger, display formatters, and a command-line utility.

## Quick start

```js
const { Money, Invoice, Ledger } = require("ledgerlight");
const ledger = new Ledger([
  new Invoice({ id: "inv-100", total: Money.fromMinor(1250, "USD") })
]);
console.log(ledger.totalOutstanding().toString());
```

The package has no runtime dependencies. Run `npm test` to execute the test suite. The command-line program supports listing invoices and formatting a money value.

Money arithmetic refuses to combine different currencies and does not silently round. Currency metadata lives in `src/currency.js`.
