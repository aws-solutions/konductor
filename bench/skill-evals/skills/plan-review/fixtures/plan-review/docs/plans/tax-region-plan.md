# Plan: add Canadian tax regions

## Purpose
Finance needs invoices for Canadian customers by 2026-12-01. Today `taxFor` in `src/billing/tax.js` throws `Unknown region` for any `CA-*` region, which blocks invoicing them. This plan adds two provinces and nothing else.

## Context
- Rates live in the `RATES` map at `src/billing/tax.js` line 1. `computeTotal` in `src/billing/invoice.js` (line 7) calls `taxFor(subtotal, invoice.region)`; it needs no change.
- Rates (source: finance ticket FIN-221, attached): `CA-ON` 0.13, `CA-BC` 0.12.
- Rounding stays as is: `Math.round(amount * rate * 100) / 100` (tax.js line 6).
- No other module reads `RATES` (checked with `grep -rn RATES src/`).

## Tasks
1. Add `'CA-ON': 0.13` and `'CA-BC': 0.12` to `RATES` in `src/billing/tax.js`.
   - Done when: `node -e "console.log(require('./src/billing/tax').taxFor(100,'CA-ON'))"` prints `13`.
2. Add tests to `tests/tax.test.js` following the existing `WA tax` test: `taxFor(100,'CA-ON') === 13`, `taxFor(100,'CA-BC') === 12`, and `taxFor(100,'CA-QC')` throws `Unknown region CA-QC`.
   - Done when: `npm test` exits 0 and reports 4 passing tests.
3. Task 2 depends on task 1. Nothing can run in parallel; the change is two edits.

## Out of scope
Quebec (QST) and any change to rounding.
