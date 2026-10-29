# fmt-kit

Tiny formatting helpers with no dependencies.

```js
const { formatDuration, formatNumber, formatPercent } = require('./src');

formatDuration(3723000);  // '1h 2m 3s'
formatNumber(1234567.5);  // '1,234,567.5'
formatPercent(0.256);     // '25.6%'
```

## Helpers

- `formatDuration(ms)` hours, minutes and seconds, leading zero units dropped
- `formatNumber(n)` thousands separators, at most one decimal place
- `formatPercent(ratio)` a ratio as a percentage with at most one decimal place
- `pad.left(text, width)`, `pad.right(text, width)` fixed-width columns

Error conventions are in `docs/STYLE.md`.

## Layout

- `src/` one file per helper, re-exported from `src/index.js`
- `test/` one test file per helper
- `examples/demo.js` prints a few values
