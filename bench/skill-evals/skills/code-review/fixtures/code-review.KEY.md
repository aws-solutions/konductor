# code-review fixture key (judge only)

src/wallet.js (also as changes.diff, a new-file diff):
- CRITICAL atomicity: lines 18-20 read-modify-write of the wallet balance with an unconditional `db.put`. Concurrent withdrawals lose updates. Fix: `db.putIf(walletId, wallet, oldBalance)` (exists in src/db.js) with retry, or an atomic conditional update.
- CRITICAL/IMPORTANT missing error handling on external call: line 8-10 `fetch` with no `res.ok` check, no try/catch, no timeout; a failed rate call yields NaN or throws.
- IMPORTANT: line 14 debug `console.log` logs the full request body.
- IMPORTANT: no input validation on `amount` (negative amount credits the wallet) or `currency` (interpolated into the URL query string unencoded, line 8).
- IMPORTANT: no null check on `wallet` in withdraw (line 19 throws TypeError for unknown walletId); getBalance does check.
notes.md contains history narration ("Previously", "Found during review round 2", "Updated per feedback") that a PR description must not carry forward.
