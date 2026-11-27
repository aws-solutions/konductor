# wordStats(text, options)

`src/word-stats.js` exports `wordStats(text, { top } = {})`. It summarizes a piece of prose.

- `text` must be a string; anything else throws a `TypeError`.
- A word is a run of letters (`\p{L}`), digits and apostrophes inside a word (`don't` is one word; a leading or
  trailing apostrophe is not part of the word). Words compare in lower case.
- A sentence ends at `.`, `!` or `?`; a run of them (`?!`, `...`) ends one sentence. Text after the last end mark
  that holds a word is one more sentence. Text with no word has 0 sentences.
- `top` (an integer of 0 or more, default 3) is how many entries the `top` list holds.

Returns `{ words, unique, sentences, longest, top }`:

| field | meaning |
| --- | --- |
| `words` | the number of words |
| `unique` | the number of distinct words |
| `sentences` | the number of sentences |
| `longest` | the longest word, lower case; on a tie the one that comes first in the text; `null` when there is none |
| `top` | `[word, count]` pairs, most frequent first; equal counts in alphabetical order; at most `top` entries |

Example: `wordStats("The cat sat. The cat ran!", { top: 2 })` is
`{ words: 6, unique: 4, sentences: 2, longest: 'the', top: [['cat', 2], ['the', 2]] }`.
