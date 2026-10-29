# Style

- One helper per file in `src/`, named after the helper, re-exported from `src/index.js`.
- Plain functions, no classes, no dependencies.
- Wrong type (not a number where a number is expected): throw `TypeError`.
- Right type but out of range (negative, NaN, Infinity where they make no sense): throw `RangeError`.
- Error messages start with the function name, for example `formatDuration: negative input`.
- Every helper has a test file with the same name in `test/`.
- Docs: one line per helper in the README and an entry under Unreleased in `CHANGELOG.md`.
