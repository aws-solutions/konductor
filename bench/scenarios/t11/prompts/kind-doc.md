## What the hidden part is: a key read from a structured block

The agent writes the document `{{OUTFILE}}`. The request asks it to end the document with one fenced ```json block holding {{BLOCKFIELDS}}. The prose above the block is for people; only the block is scored.

Write the key in `task-draft.json` as `blockKey`: `{ "outputFile": "{{OUTFILE}}", "items": [...] }`, {{NITEMS}} items, each `{ "id", "weight": 1 to 3, "type", ... }`. Item types (regexes are JavaScript, case-insensitive; dotted paths into the block):
- `text {path, all?: [regex], none?: [regex]}`: the value at path, as text, matches every `all` and no `none`.
- `some {path, match, min?}` / `none {path, match}` / `every {path, match, min?}`: list elements matching a matcher `{field?, all?: [regex], none?: [regex], num?: {gt, gte, lt, lte}}` (`field` picks a dotted field of each element; default the whole element as JSON text).
- `number {path, value, tol? | tolPct?}`, `maxLen {path, max, min?}`, `order {path, first, then}`.
A hidden test is made per item (times its weight), so the score is the weighted share of items met. Write items that a correct answer in other words still meets (match numbers, ids and short stems, not sentences), and that a shallow answer misses: the traps you seed. Add 2 to 4 items that fail on a common wrong answer (a `none` item for a superseded value, a `maxLen` against padding the list).

Write `solution/{{OUTFILE}}`: the reference document, ending with its block.
The `tests` check is `{ "type": "tests", "cmd": "node --test --test-timeout=30000 block.test.js", "min": <sum of item weights>, "weight": 3, "kind": "substance" }` (the bench supplies `block.test.js`; do not write it).
