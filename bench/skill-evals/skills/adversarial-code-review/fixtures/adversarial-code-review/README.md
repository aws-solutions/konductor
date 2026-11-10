# ledger-api

Express service that moves credits between accounts. Data lives in DynamoDB
(`accounts` and `transfers` tables) through `src/lib/ddb.js`.

Conventions:
- Every route goes through `authorize` from `src/lib/auth.js`.
- Errors are mapped to client responses by `toHttpError` in `src/lib/errors.js`.
- Pagination cursors are decoded only with `decodeCursor` in `src/lib/paginate.js`.

The change under review is `change.diff` (new transfer endpoints). A standard
review already happened; its notes are in `standard-review.md`.
