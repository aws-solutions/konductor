# Review of src/

Three real problems, ordered by severity. Two other places looked suspicious and are fine; they are listed at the end so nobody changes them.

## Findings

### 1. Path traversal in readStatement

- Severity: Critical
- Where: `src/exports.js:8`
- Why it matters: `path.resolve(dir, name)` accepts `../secret.txt` and absolute names, so a caller who controls the name can read any file the process can read.
- Fix: resolve the export directory once, resolve the name against it, and reject the call when the result is not the directory or inside it (compare with the directory plus a path separator, so a sibling such as `exports-private` does not pass). Subfolders of the directory stay allowed.

### 2. Transfer debits before it checks the destination

- Severity: Important
- Where: `src/ledger.js:19`, `src/ledger.js:20`
- Why it matters: the source is debited on line 19 and the destination is looked up on line 20. For an unknown destination the lookup throws after the debit, the money is gone and the total shrinks. This breaks the README rule that a failed transfer changes no balance.
- Fix: look up both accounts and check the funds first, then write both balances.

### 3. A failed rate refresh looks fresh

- Severity: Important
- Where: `src/rates.js:8`, `src/rates.js:11`
- Why it matters: `updatedAt` is set before the fetch and the catch block swallows the error. After one failure the cache counts as fresh for a full TTL, empty or stale rates are served and the real error is never seen. The README says refresh rejects and leaves the cache as it was.
- Fix: await the fetch first and assign `rates` and `updatedAt` only after it succeeds. Let the error propagate.

## Checked and left alone

- Minor, not a defect: `src/ids.js:5` uses `Math.random`. The ids are correlation ids for log lines and are not secrets, as the comment says. No change.
- Minor, not a defect: `src/config.js:7` uses `readFileSync`. It runs once at startup before traffic, as the comment says. No change.
