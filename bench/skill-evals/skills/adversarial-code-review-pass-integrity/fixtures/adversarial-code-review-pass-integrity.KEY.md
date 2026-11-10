# adversarial-code-review-pass-integrity fixture key

pr.diff (p1, p2):
- src/services/transfer.js:8 and :18 - debit and credit are two separate UpdateCommand calls: non-atomic multi-item mutation (CRITICAL). Credit has no condition (attribute_exists). Codebase already has src/lib/tx.js `transactWrite` (bypass of existing helper). Not in the diff; codebase awareness.
- src/repo/orderRepo.js:13 - unconditional PutCommand after a read, item has `version`: lost update; needs ConditionExpression version = :expected (CRITICAL). Also :9-11 and :14-16 read-modify-write and redundant re-read after write (SUGGESTION: ReturnValues / use `updated`). `order` undefined if missing item (not integrity focus).
- src/repo/orderRepo.js:19-27 appendAudit - single-item conditional put on a fresh UUID: must NOT be flagged as needing a transaction.
- src/workers/applyCredit.js:14 - `ADD balance` under SQS redelivery: non-idempotent retry, double credit (IMPORTANT/CRITICAL). Partial batch failure re-applies earlier records too.
- test/setup.js - unconditional BatchWrite seeding: out of scope, must NOT be flagged.
- No tests exercise transfer/orderRepo/applyCredit write paths (IMPORTANT).

clean/clean.diff (p3): transactional refund with ClientRequestToken and conditions; single-owner PutCommand with ReturnValues; teardown BatchWrite. Expected: no CRITICAL findings. Reasonable SUGGESTIONs only (e.g. preferences overwrite is fine because single owner).
