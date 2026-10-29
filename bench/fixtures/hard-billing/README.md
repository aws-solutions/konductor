# plan-billing

Pricing and policy rules for the subscription product: trials, refunds, proration, seats, quotes.

All amounts are integer cents. Times are epoch milliseconds and a day is 24 hours.

```js
const { quote, startTrial, refundFor } = require('./src');

quote({ plan: 'team', billing: 'annual', customer: { region: 'EU' } });
// { totalCents, taxCents }
```

## Rules

The numbered rules (R1 to R10) are written down twice: `docs/REQUIREMENTS.md` (product) and
`docs/API.md` (integration). The code in `src/billing/rules.js` holds the values the code uses.

## Layout

- `src/index.js` public functions
- `src/billing/rules.js` rule values
- `src/billing/*.js` one module per area (trial, refund, proration, seats, quote, grace, plan change)
- `src/util/money.js` integer rounding helpers
