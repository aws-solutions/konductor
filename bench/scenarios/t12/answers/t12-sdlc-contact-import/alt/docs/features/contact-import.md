# Contact import: requirements, design and test plan

Source: `docs/requests/contact-import.md` (Priya, 2026-11-17).

## Test plan

See `test/import.test.js`.

```json
{
 "testPlan": [
  "5,001 rows refused with nothing imported; exactly 5,000 rows import.",
  "Line numbers after a quoted field that spans two lines.",
  "Missing name and invalid email reported with lines 3 and 4, the rest imported.",
  "Duplicate within the same file.",
  "Duplicate of an existing contact, different case.",
  "CRLF line endings.",
  "Quoted commas and doubled quotes.",
  "A byte-order mark at the start.",
  "Columns in another order, phone absent.",
  "Valid rows import and are counted."
 ],
 "decisions": [
  "Duplicates are skipped with a reason, not treated as errors.",
  "Over the 5,000-row limit importContacts throws before adding anything, so no partial import.",
  "Line numbers are file lines with the header as line 1; a quoted field spanning lines shifts later rows.",
  "Own small RFC 4180 parser in src/import.js: no dependencies in this package."
 ],
 "requirements": [
  "The result gives the imported count and every skipped row with line and reason.",
  "More than 5,000 data rows: the whole file is refused before anything is imported.",
  "A row with no name or an invalid email is skipped with its file line and reason; the rest still imports.",
  "A duplicate email, compared without case, already in the book or earlier in the same file, is skipped.",
  "Quoted fields may hold commas and doubled quotes.",
  "A leading byte-order mark (BOM) is accepted.",
  "Header row names name, email and optional phone in any order."
 ]
}
```

## Design

`src/import.js` exports `importContacts(csvText, book)`. It parses the whole text first (so the row limit is checked
before any `book.add`), then adds rows one by one through the existing `createBook()` API, reusing its email rule.

- **Parser.** A small RFC 4180 parser in the module: the package has no dependencies and the format needs only
  quotes, doubled quotes, CRLF and newlines inside quotes. Blank lines are ignored.
- **Line numbers** are file lines as a spreadsheet shows them: the header is line 1, and a row reports the line it
  starts on, so a quoted field spanning two lines moves the following rows down by one.
- **Over the limit** the function throws an Error naming the limit; nothing is imported. Partial imports of big files
  would leave customers unsure what got in.
- **Duplicates** are not errors: they are skipped with the reason `duplicate`.

## Requirements

1. Import a UTF-8 CSV with a header row naming `name`, `email` and optionally `phone`, in any column order.
2. Accept a leading byte-order mark and quoted fields holding commas or doubled quotes (RFC 4180).
3. Skip a row whose email (compared without case) is already in the address book or appeared earlier in the same file.
4. Skip a row with no name or an invalid email, report its file line and the reason, and keep importing the rest.
5. Refuse a file with more than 5,000 data rows as a whole, before importing anything.
6. Return the number imported and every skipped row with its line and reason.
