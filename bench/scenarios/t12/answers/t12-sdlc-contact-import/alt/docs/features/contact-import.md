# Feature note: CSV contact import

Request: `docs/requests/contact-import.md` (Priya, 2026-11-17). Code: `src/import.js` and `src/csv-records.js`.
Tests: `test/csv-records.test.js` (the reader) and `test/import-rules.test.js` (one test per agreed rule).

## Design

The import runs in two passes. The first reads every record of the file through a small state-machine reader
(`records()` in `src/csv-records.js`), so the row count is known before anything changes. The second offers each row
to `book.add()` from `src/contacts.js`, which already owns the name and email rules; when it refuses a row, its own
message becomes the skip reason, so the import and the address book can never disagree on what a valid contact is.

Duplicates are checked before `book.add()`: against `book.has()` and against a set of the lower-cased emails added
earlier from the same file. Line numbers are those a spreadsheet shows: the header is line 1, and a record reports
the line it starts on, so a quoted name with a line break pushes the next rows down.

A file with more than 5,000 data rows throws a `RowLimitError` whose message gives the count and the limit.

```json
{
  "requirements": [
    "Read a UTF-8 CSV whose header row names name and email (phone optional), with the columns in any order.",
    "Ignore a leading byte-order mark (BOM) from spreadsheet exports.",
    "Read quoted fields holding commas, doubled quotes or line breaks.",
    "Skip a row whose email, compared without case, is already in the address book or came earlier in the same file.",
    "Skip a row with an empty name or an invalid email, and report its file line and the reason; keep importing the rest.",
    "Refuse a file with more than 5,000 data rows as a whole, before importing anything.",
    "Return how many contacts were imported and every skipped row with its line and reason."
  ],
  "decisions": [
    "A hand-written state-machine CSV reader instead of a dependency: the package has none, and the rules needed are small (RFC 4180 quoting).",
    "Read all records before adding any, so the 5,000-row limit is checked first and an over-limit file throws a RowLimitError with nothing imported.",
    "Reuse book.add() for name and email validation and pass its message on as the reason, so there is one definition of a valid contact.",
    "Line numbers are file lines with the header as line 1, and a record that spans several lines reports the line it starts on."
  ],
  "testPlan": [
    "Header in another order, missing phone, a BOM and CRLF line ends import cleanly.",
    "Quoted commas, doubled quotes and a quoted line break are read; the record after it reports the right file line.",
    "Blank lines are dropped but counted.",
    "Duplicate of a contact already in the book, in a different case, is skipped.",
    "Duplicate within the same file is skipped at its own line.",
    "Empty name and invalid email are skipped with lines and reasons; the other rows import.",
    "Exactly 5,000 rows import; 5,001 rows are refused and the book stays empty."
  ]
}
```
