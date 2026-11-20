# Lantern Cart Pricing

Lantern Market keeps its checkout arithmetic in a small CommonJS module. The
library accepts cart lines with `sku`, `quantity`, and numeric `unitPrice`
fields. Prices are expressed in the shop's currency units, not integer cents.

```js
const { calculateOrder } = require('./src');

const quote = calculateOrder({
  lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 8.5 }],
  shippingMethod: 'standard'
});
```

A quote contains `subtotal`, `discount`, `shipping`, `tax`, and `total`.
The default shipping method is `standard`. The pricing module is deliberately
free of I/O except for loading its default JSON configuration.

Run the checks with `node --test test/`. Node 24 is the supported runtime.
