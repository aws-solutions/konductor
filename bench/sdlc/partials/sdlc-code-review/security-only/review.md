# Review

## Findings

- [high] `src/wallet.js:33` The export name from the query string can contain `../` and write outside the export
  directory. Allow only safe characters.
- [high] `src/wallet.js:16` A negative amount is not rejected and moves money the wrong way. Validate the amount.

Verdict: REQUEST CHANGES
