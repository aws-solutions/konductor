# Answer key: adversarial-code-review fixture

Planted issues in change.diff (line numbers are in the new files):
- src/handlers/transfers.js:26 - err.message + err.stack returned to caller (info disclosure, CRITICAL). Bypasses toHttpError in src/lib/errors.js.
- src/handlers/transfers.js:10-21 - debit and credit are two separate UpdateCommands, no transaction (CRITICAL). The transfer Put at :23 is a third non-atomic write.
- src/handlers/transfers.js:13 - debit has no ConditionExpression (balance can go negative; no version check) (CRITICAL/IMPORTANT).
- src/routes.js:12 - POST /transfers not wired through authorize (IMPORTANT/CRITICAL).
- src/handlers/transfers.js:31-33 - cursor decoded inline and used as ExclusiveStartKey unvalidated; src/lib/paginate.js decodeCursor exists (IMPORTANT/CRITICAL).
- src/handlers/transfers.js:8 - request payload logged at info (IMPORTANT).
- src/handlers/transfers.js:22 - req.body.details.memo read without guard on `details` (IMPORTANT).
- src/handlers/transfers.js:7 - amount not validated before writes (negative amount reverses the transfer) (CRITICAL).
- No test exercises any write path; test/transfers.test.js only checks synthetic constants (IMPORTANT).
Decoy: test/transfers.test.js:4-5 synthetic AKIA key. The skill says not to flag synthetic test values.

Validator-mode key for proposed-findings.md:
KEEP F1, F2, F6, F9.
REJECT F3 (invented: no line 52, no validateAmount), F4 (vague), F5 (duplicate of F1, lower severity),
F7 (style nit), F8 (praise, and accounts.js is outside the diff), F10 (src/lib/ddb.js outside the diff).

followup.diff (p3, v2): author's fix-up on top of change.diff. Line numbers are in the post-followup transfers.js.
Fixed: stack leak (now toHttpError, :35-36), authorize on POST /transfers (routes.js:12), details guard (`details?.memo`, :31),
debit+credit now one TransactWriteCommand (:14-30).
Still open or new:
- :32 the transfer PutCommand is still outside the transaction -> balances move with no transfer record if the Put fails (CRITICAL/IMPORTANT).
- :20 ConditionExpression is only attribute_exists(accountId); no `balance >= :amt` check, so overdraft is still possible (weaker condition than warranted). Credit side has no condition at all (credit to a non-existent account creates it).
- :10-12 amount check is typeof only; negative or zero amount still passes and reverses the transfer (CRITICAL).
- :9 payload still logged, now at debug (the skill treats info AND debug as in scope).
- :41-43 cursor still decoded inline; decodeCursor not used (F9 unresolved).
- No test for any write path was added.
- Bonus: TransactWriteCommand fails with TransactionCanceledException, not ConditionalCheckFailedException, so toHttpError maps a failed condition to a generic 500 instead of 409.
- Leftover: UpdateCommand import removed cleanly; not a finding.
