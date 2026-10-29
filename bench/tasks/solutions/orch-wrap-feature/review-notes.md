# Review notes for wrapText

What I would flag if someone else sent this change (`src/wrap.js`, `test/wrap.test.js`, README):

- Whitespace handling: `text.split(/\s+/)` treats newlines, tabs and repeated spaces as one separator, so paragraph breaks and indentation are lost. That is fine for plain wrapping but should be stated in the README.
- Width of 0 or less: every word ends up on its own line (the first branch always accepts a word when the line is empty). Either document it or throw a RangeError, because a caller passing 0 probably has a bug.
- Long words: a word longer than `width` stays whole on its own line, as the task asks. A URL in the text will therefore overflow; hyphenating is out of scope but worth a note.
- Non-string input: `wrapText(null, 10)` throws a TypeError from `split`. The other textkit functions coerce with `String(...)`, so the behaviour is inconsistent.
- Tests: they cover a normal wrap, a long word, empty text and a line exactly at the width. Missing: a width of 0, text with newlines, and text with only spaces (returns `[]`, which is right but unasserted).
- Style: the loop is small and readable. `line.length + 1 + word.length <= width` is the only line a reader has to think about; a one-line comment would help.
