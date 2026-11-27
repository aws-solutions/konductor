# Changelog

## Unreleased

- FMT-9: `formatDate(iso, 'long')` prints dates in words (`2 March 2026`); any style other than `iso` or `long` throws.
- FMT-7: `formatMoney(cents, currency, { accounting: true })` prints a negative amount in brackets, such as `(€12.50)`.

## 1.3.0

- formatMoney takes a currency code (USD, EUR, GBP).
