# What src/csv.js does

The file has two functions for reading CSV text. It has no dependencies.

## parseLine(line)

`parseLine` turns one line of text into an array of fields.

- It reads the line one character at a time and splits at each comma.
- A double quote switches "inside quotes" on or off. While inside quotes, a comma is part of the field and does not split it. So `"a,b",c` becomes `['a,b', 'c']`.
- The quote characters themselves are not kept in the output.
- At the end, the last field is added only if it is not empty.

## parseCsv(text)

`parseCsv` turns a whole CSV text into an array of rows.

- It splits the text on newline characters.
- Blank lines (empty strings) are skipped.
- Each remaining line goes through `parseLine`.

## Things to know

- Each line is parsed on its own, so a quoted field cannot span lines.
- Windows line endings leave a `\r` on the last field of each row.
- The behaviour is covered by three small tests in `test/csv.test.js`.
