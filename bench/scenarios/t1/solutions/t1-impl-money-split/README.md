# Ledgerlight

Ledgerlight is a deliberately small billing library for applications that keep money as integer minor units. It includes currencies, invoices, a ledger, display formatters, allocation helpers, and a command-line utility.

## Quick start

```js
const { Money, Invoice, Ledger, allocatePayment } = require("ledgerlight");
const ledger = new Ledger([
  new Invoice({ id: "inv-100", total: Money.fromMinor(1250, "USD") })
]);
const result = allocatePayment(Money.fromMinor(500, "USD"), [{ id: "inv-100", due: ledger.get("inv-100").balance }]);
console.log(result[0].amount.toString());
```

The package has no runtime dependencies. Run `npm test` to execute the test suite. See `docs/allocation.md` for weighted splits, payment rules, and the command-line forms.

Money arithmetic refuses to combine different currencies and does not silently round. Currency metadata lives in `src/currency.js`.
