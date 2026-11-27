# slugify(text, options)

`src/slugify.js` exports `slugify(text, { maxLength } = {})`. It turns a title into a URL path segment.

Rules, in order:

1. `text` must be a string; anything else throws a `TypeError`.
2. Letters with accents lose them: decompose with `normalize('NFD')` and drop the combining marks (`é` becomes `e`).
   `ß` becomes `ss` and `æ` becomes `ae`.
3. Lower case.
4. `&` becomes the word `and`, with a word break on each side.
5. Every run of characters that is not `a-z` or `0-9` becomes one `-`.
6. No `-` at the start or the end.
7. `maxLength` (an integer of 1 or more, default 60): when the slug is longer, cut it at the last `-` that keeps it
   within `maxLength`; when there is no such `-`, cut it at `maxLength` exactly. Never end on `-`.
   A `maxLength` that is not an integer of 1 or more throws a `RangeError`.
8. An empty result is the string `n-a`.

Examples:

| text | options | slug |
| --- | --- | --- |
| `Hello, World!` | | `hello-world` |
| `Crème brûlée & café` | | `creme-brulee-and-cafe` |
| `Straße` | | `strasse` |
| `  --  ` | | `n-a` |
| `The quick brown fox` | `{ maxLength: 12 }` | `the-quick` |
| `Supercalifragilistic` | `{ maxLength: 5 }` | `super` |
