## What the hidden part is: a key over a JSON block

The agent writes a document at `{{OUTFILE}}`: a guide, a reference, a triage decision or a log analysis, the kind the brief asks for. It ends with a fenced ```json block holding one JSON object. The request must describe that object's fields in plain words (names, types, units; if a field holds times, that they are ISO 8601 UTC; if it cites the folder, that a citation is `path:line`, the file path relative to the folder root and the 1-based line number). Do not paste an example block that holds real values from the fixture; a placeholder such as `docs/some-guide.md:12` is fine.

The block's fields for this task: {{BLOCKFIELDS}}

Write the request, the block and the key for the brief's document. Do not copy an incident report onto it: no root cause, timeline, metrics or ordered response steps unless the brief itself asks for them.

A bench-provided script (`kit/block-key.js`, read its header for the exact rules) grades the block against a key you write. Put the key in `task-draft.json` as `blockKey`: `{ "outputFile": "{{OUTFILE}}", "items": [ ... ] }`, {{NITEMS}} items. Each item has `id`, `type`, an optional `weight` (1 to 3) and the fields of its type:
- `text` {path, all, none}: the value at a dotted path, as text, matches every regex in `all` and none in `none`.
- `some` / `none` / `every` {path, match}: list elements matching a matcher `{field?, all?, none?, num?: {gt, gte, lt, lte}, timeNear?: {time, tolMin}, timeIn?: [from, to], timeField?}`. Times come from `timeField`, else `field`, else the element's `time`.
- `order` {path, first, then}: the first element matching `first` comes before the first matching `then`.
- `number` {path, value, tol | tolPct}: a number within the tolerance.
- `maxLen` {path, max, min}: list length bounds (a precision term: a list that names everything does not win).
- `inSet` {path, field, fromFile, pattern}: every value of `field` is one of the names a fixture file defines (for example every script a guide tells you to run exists in package.json).
- `evidence` {path, groups: [{all, file}], min}: cited `path:line` refs must hit lines whose text matches each group's regexes.
- `evidencePrecision` {path, relevant, min}: the share of cited lines that are relevant.
Example items for document work, exactly in this shape (every item has an `id`; a matcher is one flat object; the field names are examples, use the ones this task's block has):
```
{ "id": "setup-uses-pnpm", "type": "some", "path": "commands", "match": { "field": "command", "all": ["^pnpm (i|install)\\b"] }, "weight": 2 }
{ "id": "no-retired-script", "type": "none", "path": "commands", "match": { "field": "command", "all": ["test:unit|legacy-migrate"] } }
{ "id": "scripts-exist", "type": "inSet", "path": "commands", "field": "script", "fromFile": "package.json", "pattern": "^\\s*\"([a-z:-]+)\":" }
{ "id": "dup-merged", "type": "some", "path": "decisions", "match": { "field": "action", "all": ["duplicate|merge|close"], "none": ["\\bnot\\b|keep open"] } }
{ "id": "retry-default", "type": "some", "path": "functions", "match": { "field": "maxAttempts", "num": { "gte": 5, "lte": 5 } } }
{ "id": "conventions-cited", "type": "evidence", "path": "conventions", "groups": [{ "file": "CONTRIBUTING.md", "all": ["branch"] }], "min": 1 }
```
Paths in `fromFile` and `file` are relative to the folder root the agent works in (no `fixture/` prefix). Do not change anything under `kit/`.
All regexes are JavaScript, case-insensitive, and every regex field (`all`, `none`, `relevant`) is a LIST of strings. A matcher reads only `field`, `all`, `none`, `num`, `timeNear`, `timeIn` and `timeField`; any other key is ignored, so a matcher with only `timeNear` accepts any element at that time. Rules for a fair key:
- A hurried reader who reads only the README and the first 60 lines of each file must not be able to name the facts the key checks. Put the proving lines deep inside the large files, and keep small summary files (release notes, tickets, old guides, to-do lists) neutral or only partly telling.
- The request never states the facts the agent has to find: no script names, defaults, owners, severities, causes or file list.
- The request never says which old rule or suspect is the decoy, and never lists the files or log lines to look at first.
- Each item tests one thing a careful practitioner gets right and a quick answer gets wrong. Most items are substance: the right command, default, decision, count or cause.
- Key audit rules (from the 2026-11-24 key fixes; every T13 key of the first batch needed a hand edit for one of these):
  - Read only the fields the request names: never add a field the request does not name, and never put an item on a field the block does not have.
  - Match a field, not the element's JSON text: a pattern such as `regression.*false` over a whole element depends on key order; use the matcher's `field` (or `"regression"\s*:\s*false` when the value must be read as JSON).
  - Do not bind an item to a list position (`functions.0.defaults`); find the element with `some` and a matcher.
  - A number gets its tolerance and nothing else: no exact-string pattern beside a tolerance (`^1800$` next to `tolPct: 5` fails a correct 1,790).
  - No length cap the request does not set; `maxLen` only bounds a list the request asks to keep short.
  - Accept every reasonable phrasing: alternations with synonyms and number forms (`8|eight`, `4 ?h|four hours`), and require two or more patterns where one word could appear in a wrong answer. A one-word alternative under four letters matches inside other words (`void` in `avoid`); write the phrase instead.
  - A fact an answer can only get by asking the scripted user is matched in loose forms, since the user's reply is reworded by every agent.
  - Dates respect the folder's own calendar (a holiday or a freeze moves a date; accept both the stated date and the last working day before it when the folder supports either).
- With `timeNear`, do not also put the time as a literal pattern in `all`: the tolerance must decide. Evidence groups should accept any of the lines that show the same fact.
- Numbers and times must be derivable from the fixture alone; state units in the request; give a tolerance (times 2 to 5 minutes, counts 3 to 10 percent).
- The seeded facts come from the generator, so compute the key values from the generated files with a small script, not by hand.
{{KINDEXTRA}}

Write `solution/` with the reference document at `{{OUTFILE}}` (a real document a senior engineer would write, ending with the block). The tests check is `{ "type": "tests", "cmd": "node --test --test-timeout=15000 block.test.js", "min": <the number of tests: the sum of item weights>, "weight": 3, "kind": "substance" }`. Do not write the grader or `hidden/` yourself; `kit/selfcheck.js` builds it from `blockKey`.
