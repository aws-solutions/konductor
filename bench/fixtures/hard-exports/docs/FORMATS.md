# Export formats

Every format turns `rows` (an array of plain objects) and `columns` (the column names, in order) into text.
A missing, `null` or `undefined` value is written as an empty field. Lines end with `\n`, and the text ends with
one `\n` after the last line.

## csv

The first line holds the column names. A field holding a comma, a double quote, `\r` or `\n` is wrapped in double
quotes, and each double quote inside it is doubled.

## json

`JSON.stringify` of an array with one object per row, holding only `columns` in their order, indented by 2
spaces, followed by `\n`. A missing value is written as `null`.

## tsv (planned)

Tab-separated values for spreadsheet import.

- The first line holds the column names; fields are separated by one tab.
- In a field (names included), a backslash is written `\\`, a tab `\t`, a newline `\n` and a carriage return `\r`
  (a backslash followed by the letter). Nothing is quoted.
- Content type `text/tab-separated-values; charset=utf-8`, extension `.tsv`.

## Planned after tsv

`xml` and `ndjson` are next on the roadmap. Each new format has a name, a content type, a file extension and a
render function, like the formats above.
