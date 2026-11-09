# shipquote

A small shipping quote library. Give it an order and a destination, get back the carrier options with prices.

## Use

```js
const { quote, listCarriers, normalizeAddress } = require('./src');

quote({ items: [{ weightKg: 2 }], to: { zip: '78701', country: 'us' } });
// { zone: 3, weightKg: 2, to: {...}, options: [ { carrier: 'standard', base: 6.8, fuel: 0.54, total: 7.34 }, ... ] }
```

- `quote(order)`: `order.items` is a list of `{ weightKg, qty }` (`qty` defaults to 1), `order.to` is an address and `order.carrier` optionally limits the answer to one carrier. Options come back cheapest first.
- `listCarriers()`: the carrier ids.
- `normalizeAddress(raw)`: trims fields, uppercases the zip and country, defaults the country to `US`.

Errors are plain `Error`s with a message such as `order has no items` or `unknown carrier: drone`.

## Layout

- `src/index.js`: the public API.
- `src/address.js`: address cleanup and validation.
- `src/zones.js`: zip to zone lookup.
- `src/util.js`: shared helpers (`roundCents`, `normalizeZip`).
- `src/rates.js`: prices an order with one carrier (base, fuel, total).
- `src/carriers/*.js`: one file per carrier. Each exports `id`, `fuelPct`, `available(weightKg, country)` and `baseRate(weightKg, zone)`.

Run the tests with `npm test`.
