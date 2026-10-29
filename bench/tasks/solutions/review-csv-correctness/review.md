# Review of src/csv.js

I ran `parseLine` and `parseCsv` on tricky inputs instead of reading only. Four correctness bugs, ordered by severity. Commas inside quotes work as intended and are not a bug.

## 1. Doubled quotes inside a quoted field are dropped (high)

Line: `src/csv.js:10-11`. The code flips `inQuotes` on every `"`, so an escaped quote (`""`) toggles twice and nothing is added to the field.

- Input: `"say ""hi"""`
- Actual: `[ 'say hi' ]`
- Expected: `[ 'say "hi"' ]`
- Fix: when `inQuotes` is true and the next character is also `"`, append one `"` and skip ahead; otherwise toggle.

## 2. A trailing empty field is dropped (high)

Line: `src/csv.js:19`. `if (current !== '') fields.push(current)` skips the last field when it is empty.

- Input: `a,b,`
- Actual: `[ 'a', 'b' ]`
- Expected: `[ 'a', 'b', '' ]`
- Fix: always push the last field, `fields.push(current)`. Check that `parseLine('')` should return `['']` or `[]` and decide which.

## 3. A newline inside a quoted field splits the row (medium)

Line: `src/csv.js:26`. `parseCsv` splits the text on every `\n` before parsing, so a quoted field that contains a line break is cut in two.

- Input: `a,"x\ny"\n`
- Actual: `[ [ 'a', 'x' ], [ 'y' ] ]`
- Expected: `[ [ 'a', 'x\ny' ] ]`
- Fix: scan the whole text with the same quote state and only end a row on a newline outside quotes.

## 4. CRLF input leaves a carriage return on the last field (medium)

Line: `src/csv.js:26`. Splitting on `\n` only leaves the `\r` of `\r\n` at the end of each row.

- Input: `a,b\r\nc,d\r\n`
- Actual: `[ [ 'a', 'b\r' ], [ 'c', 'd\r' ] ]`
- Expected: `[ [ 'a', 'b' ], [ 'c', 'd' ] ]`
- Fix: split on `/\r?\n/`, or handle `\r` in the scanner from fix 3.

## What works

- `a,b,c` gives three fields, and `"a,b",c` keeps the comma inside the quotes.
- Blank lines are skipped by `parseCsv`.
