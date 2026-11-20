# Larkspur Tea checkout

The checkout page of the Larkspur Tea shop, built as static files: `site/index.html` loads plain ES modules from
`site/src/`. There is no bundler and nothing to install.

- `site/src/pricing.js`: subtotal, delivery and promo code rules (whole pence).
- `site/src/format.js`: money display and form validation.
- `site/src/checkout.js`: the page itself (basket, delivery choice, promo code, details form, confirmation).
- `docs/checkout.md`: the rules as the shop team wrote them.

## Tests

- `npm test` (or `node --test test/*.test.mjs`): unit tests of the pricing and validation rules.
- `npm run test:e2e` (or `node --test --test-timeout=20000 e2e/*.e2e.test.js`): browser tests. `e2e/support/browser.js` serves
  `site/` on 127.0.0.1 and opens headless Chromium; each test file is `e2e/*.e2e.test.js`. Playwright is not a
  dependency of this repository: the CI image has it at the path in `e2e/e2e.config.json`.

To look at the page by hand, serve `site/` with any static server bound to 127.0.0.1.
