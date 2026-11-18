# Review: audit, statements, exports and retries (CHANGE.diff)

Checked: correctness, concurrency, security of user input, tests, and resilience of the retry path. Severity scale:
critical loses money or data for many users, high for some, medium breaks a feature, low is a gap with a workaround.

## Findings

- [critical] `src/wallet.js:17` Lost update under concurrent transfers. `transfer` reads both wallets, awaits the
  store and then writes balances computed from the earlier read. Two transfers from one wallet at once both pass the
  balance check and both write, so money is spent twice. Fix: take the read, check and write under a lock per wallet
  (or a compare-and-set on a version), and write both wallets in one store transaction.
- [high] `src/wallet.js:16` No check that `amountCents` is a positive integer. A negative amount passes the balance
  check and moves money from `toId` to `fromId`. Fix: reject anything that is not an integer above 0.
- [high] `src/wallet.js:33` Path traversal. `name` comes from the query string, so `../../etc/cron.d/x` writes
  outside `exports/`. Fix: allow only `[A-Za-z0-9_-]{1,64}` or generate the file name, and check the resolved path
  stays under `EXPORT_DIR`.
- [medium] `src/wallet.js:27` Off by one: pages are 1-based, so `page * pageSize` skips the first page and page 1
  returns entries 20 to 39. Fix: `(page - 1) * pageSize`, and reject `page < 1`.
- [medium] `src/wallet.js:41` The retry loop never stops and has no back-off: while the mail provider is down it
  spins one CPU and never returns. `MAX_RETRIES` is defined and unused. Fix: at most `MAX_RETRIES` attempts with
  exponential back-off, then rethrow the last error.
- [low] `test/wallet.test.js:13` `assert.ok(result)` passes for any return value, so the test would not catch a
  wrong balance. Fix: assert both balances (300 and 200), and add tests for a negative amount and two transfers at once.

Not flagged: `== null` in `src/format.js` is intended (null and undefined), and the sequential `await` in
`auditBatch` keeps the audit log ordered, as its comment says.

Verdict: REQUEST CHANGES
