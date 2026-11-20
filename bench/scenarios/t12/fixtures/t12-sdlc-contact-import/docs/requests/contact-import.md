# Request: import contacts from a CSV file

From: Priya (product), 2026-11-17. Agreed with support.

Customers move to us from spreadsheets and re-type hundreds of contacts. We want an import.

- The file is CSV, UTF-8, with a header row. Columns: `name`, `email`, `phone`. `phone` may be missing or empty;
  the header may list the columns in any order.
- Spreadsheet exports often start with a byte-order mark and quote fields that hold commas
  (`"Ngata, Aroha"`). Both must work.
- A row whose email is already in the address book, or appeared earlier in the same file, is skipped, not an error.
  Emails compare without case.
- A row with no name or an invalid email is skipped with its line number and the reason, and the rest of the file
  still imports. Support needs the line numbers to help customers fix their files.
- Files over 5,000 data rows are refused as a whole, before anything is imported (the address book plan limit).
- The result tells the customer how many contacts were imported and lists every skipped row with its line and reason.

Support also wants a short help page for customers.
