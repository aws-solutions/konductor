# textkit

Small text helpers with no dependencies.

## Functions

- `slugify(text)`: turns a title into a URL slug.
- `capitalize(text)`: upper-cases the first letter.
- `truncate(text, max)`: shortens text to `max` characters, adding `...`.
- `initials(name)`: first letters of each word, upper-cased.
- `countWords(text)`: counts words.
- `longestWord(text)`: returns the longest word.
- `parseLine(line)` and `parseCsv(text)`: minimal CSV parsing.

## Development

Run the tests with `npm test` (uses the built-in Node test runner).
