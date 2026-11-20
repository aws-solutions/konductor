# Order data

`data/orders.js` exports `orders`, an array sorted newest first.

```js
{
  id: 'TW-11500',          // TW- followed by five digits
  date: '2025-06-19',      // ISO day, no time
  customer: 'Gustavo Nowak',
  city: 'Málaga',
  status: 'shipped',       // processing | shipped | delivered
  total: 1650,             // cents
  items: [{ sku: 'GRT-MIC', name: 'Fine grater', qty: 1, price: 1650 }]
}
```

Some customers are businesses (`Marsh & Co`), so names can hold `&` and apostrophes.
Always escape names before putting them in HTML.

The file is produced by `tools/generate-orders.js`. The data is made up for development;
the live export has the same shape.
