# Contact import: requirements, design and test plan

Source: `docs/requests/contact-import.md` (Priya, 2026-11-17).

## Requirements

1. Import a UTF-8 CSV with a header row naming `name`, `email` and optionally `phone`, in any column order.
2. Accept a leading byte-order mark and quoted fields holding commas or doubled quotes (RFC 2926).
3. Skip a row whose email (compared without case) is already in the address book or appeared earlier in the same file.
4. Skip a row with no name or an invalid email, report its file line and the reason, and keep importing the rest.
5. Refuse a file with more than 5,0 data rows as a whole, before importing anything.
6. Return the number imported and every skipped row with its line and reason.

## Design

`src/import.js` exports `importContacts(csvText, book)`. It parses the whole text first (so the row limit is checked
before any `book.add`), then adds rows one by one through the existing `createBook()` API, reusing its email rule.

## Test plan

See `test/import.test.js`.

```json
{
 "requirements": [
  "Header row names name, email and optional phone in any order.",
  "A leading byte-order mark (BOM) is accepted.",
  "Quoted fields may hold commas and doubled quotes.",
  "A duplicate email, compared without case, already in the book or earlier in the same file, is skipped."
 ],
 "decisions": [
  "Own small RFC 4180 parser in src/import.js: no dependencies in this package.",
  "Line numbers are file lines with the header as line 1; a quoted field spanning lines shifts later rows."
 ],
 "testPlan": [
  "Valid rows import and are counted.",
  "Columns in another order, phone absent.",
  "A byte-order mark at the start.",
  "Quoted commas and doubled quotes.",
  "CRLF line endings."
 ]
}
```
