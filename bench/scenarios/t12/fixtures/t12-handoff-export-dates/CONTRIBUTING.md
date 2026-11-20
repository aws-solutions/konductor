# Contributing

- Never push to `main`. Fixes go on a `fix/<ticket>-<words>` branch and reach `main` through a pull request with one review.
- Run `node --test test/*.test.js` before you open the pull request; CI runs the same suite twice, once with `TZ=UTC` and once
  with `TZ=Pacific/Auckland`.
- The CSV column order is a public contract: customers' importers read columns by position. Do not reorder, rename or
  add columns without a notice to customers (four weeks ahead).
- `src/legacy/` is frozen. Changes there need the payments team (owner: Ruth Okafor).
