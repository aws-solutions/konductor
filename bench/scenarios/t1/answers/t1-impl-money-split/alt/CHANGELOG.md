# Changelog

## 2.5.0 - 2025-03-15

- Add `splitByWeights(total, parts)` to split an amount by weights with largest remainder placement.
- Add `allocatePayment(payment, invoices)` to allocate a payment across invoices with largest remainder placement.
- Both functions validate inputs, sort results by id, conserve every minor unit, and handle tie-breaking by lexicographically smallest id.
- Add `split` and `allocate` CLI commands with `--amount`, `--currency`, `--weights`, and `--invoices` flags.

## 2.4.0 - 2025-02-14

- Improve invoice validation messages.
- Add ledger export helpers.

## 2.3.0 - 2024-11-08

- Add JPY and KWD currency definitions.
- Keep command output stable for scripts.

## 2.2.0 - 2024-07-19

- Initial public release.

