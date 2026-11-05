# Library lending API: requirements

A JSON REST API for a book-lending service. Clients are a web app and a mobile app.

## Resources and operations

- Books. Create a book (title, ISBN, authors, number of copies), get one by id, change the title or the number of copies, delete a book, and list books.
  - Title is 1 to 300 characters. ISBN is 13 digits. A book has 1 to 10 authors. Copies is a whole number from 1 to 100.
  - A book cannot be deleted while any copy is on loan.
  - The catalog has about 2 million books, so the list must be paged. It can be filtered by author name.
- Loans. A member borrows a book, returns it, can look up one loan, and can list their own loans, newest first. The list is paged.
  - Borrowing fails when no copy is available.
  - Mobile clients retry requests on bad networks. A retried borrow request must never lend two copies.
  - A loan records the book, the member, the borrow time and the due time.
- Members can renew a loan up to twice, each time for 14 days.

## Conventions

- Identifiers are UUIDs. Times are ISO 8601 date-times in UTC.
- Every operation needs a bearer token. There is no anonymous access.
- Errors: 400 for invalid input, 404 when a book or loan does not exist, 409 when the request conflicts with the current state (no copy available, book has active loans), 429 when the client is throttled.
- Create operations answer 201. Deleting answers 204 with no body.
- Reading must not change anything.

## Out of scope

Fines, reservations, the nightly overdue report and member sign-up.
