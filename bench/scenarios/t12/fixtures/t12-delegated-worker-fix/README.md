# parcel-desk

Quotes for the parcel counter: the clerk types the weight the scale shows and the ship date, and gets the price, the
delivery date and the label text.

```js
const { quote } = require('./src/index.js');
quote({ weight: '2.5 kg', shipDate: '2026-03-02', service: 'standard' });
// { kg: 2.5, price: 9.4, eta: '2026-03-05', label: 'PARCEL 2.5 kg | standard | due 2026-03-05' }
```

Services: `standard` (3 business days) and `express` (1 business day). Prices are in `src/price.js`, holidays in
`config/holidays.json`.

Run the tests with `npm test` (`node --test test/*.test.js`).
