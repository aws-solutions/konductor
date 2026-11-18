# Review

## Findings

- [high] `src/wallet.js:17` Two transfers at once can both read the old balance; a lost update.
- [medium] `src/wallet.js:27` Page 1 skips the first page.
- [medium] `src/format.js:5` Use `===` instead of `==`.
- [low] `src/wallet.js:54` Await in a loop is slow; use `Promise.all`.
- [nit] `src/wallet.js:8` `EXPORT_DIR` could be configurable.
- [nit] `src/wallet.js:3` Group the requires.
- [nit] `src/wallet.js:22` Return an object with named fields instead.
- [nit] `src/audit.js:3` `entries` should be a class.

Verdict: APPROVE
