# API notes

The model is `model/main.smithy` (Smithy 2.0, namespace `example.library`). Nothing was compiled or validated with the Smithy tool; the model was checked by reading it.

## Design choices

- Two resources, `Book` and `Loan`, with the lifecycle operations bound to the resource (create, read, update, delete, list) and `ReturnLoan` as an extra instance operation.
- Both list operations use `@paginated` with `nextToken` and `maxResults`, because the catalog has about 2 million books.
- `CreateLoan` has a `clientToken` member with `@idempotencyToken`. A retried request carries the same token, so the service can return the first loan instead of lending a second copy.
- Reads are `@readonly`. `DeleteBook` and `ReturnLoan` are `@idempotent`.
- Errors: 400 validation (service level), 404 book or loan not found, 409 no copy available or book has active loans, 429 throttling with `@retryable(throttling: true)`.
- Limits come from the requirements: title length 1 to 300, ISBN 13 digits, 1 to 10 authors, copies 1 to 100.
- The whole service is `@httpBearerAuth`.

## Open questions and assumptions

1. Renewals. The requirements say members can renew a loan twice for 14 days but list no renewal operation. Not modeled. Assumption: a `RenewLoan` operation (POST `/loans/{loanId}/renew`) will be added once the rules for refusal (reserved copies, overdue loans) are known.
2. Who is the caller. Loans are listed by a `memberId` query member. Assumption: the service checks that the token belongs to that member, or to staff.
3. Due date. The requirements do not say how long a first loan lasts. Assumption: the service sets `dueAt` and the client cannot choose it.
4. Author filter. Exact match or prefix match is not stated. Assumption: exact, case-insensitive.
5. Page size. Assumption: default 25, maximum 100.
6. Throttling limits are not given, so no `Retry-After` member is modeled.
