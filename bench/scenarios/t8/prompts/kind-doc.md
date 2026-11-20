## What the hidden part is: a key over a JSON block

The agent writes a document at `{{OUTFILE}}`. It ends with a fenced ```json block holding one JSON object. The request must describe that object's fields in plain words (names, types, units, and that times are ISO 8601 UTC and log evidence is cited as `path:line`, the file path relative to the folder root and the 1-based line number). Do not paste an example block that holds real values from the fixture; a placeholder such as `logs/some.log:123` is fine.

The block's fields for this task: {{BLOCKFIELDS}}

A bench-provided script (`kit/block-key.js`, read its header for the exact rules) grades the block against a key you write. Put the key in `task-draft.json` as `blockKey`: `{ "outputFile": "{{OUTFILE}}", "items": [ ... ] }`, {{NITEMS}} items. Each item has `id`, `type`, an optional `weight` (1 to 3) and the fields of its type:
- `text` {path, all, none}: the value at a dotted path, as text, matches every regex in `all` and none in `none`.
- `some` / `none` / `every` {path, match}: list elements matching a matcher `{field?, all?, none?, num?: {gt, gte, lt, lte}, timeNear?: {time, tolMin}, timeIn?: [from, to], timeField?}`. Times come from `timeField`, else `field`, else the element's `time`.
- `order` {path, first, then}: the first element matching `first` comes before the first matching `then`.
- `number` {path, value, tol | tolPct}: a number within the tolerance.
- `maxLen` {path, max, min}: list length bounds (a precision term: a list that names everything does not win).
- `inSet` {path, field, fromFile, pattern}: every value of `field` is one of the names a fixture file defines (for example every metric a plan gates on exists in the metrics catalogue).
- `evidence` {path, groups: [{all, file}], min}: cited `path:line` refs must hit lines whose text matches each group's regexes.
- `evidencePrecision` {path, relevant, min}: the share of cited lines that are relevant.
Example items, exactly in this shape (every item has an `id`; a matcher is one flat object):
```
{ "id": "cause-named", "type": "text", "path": "rootCause.summary", "all": ["pool|connections?", "40|reduc"], "none": ["caused by (the )?deploy"], "weight": 3 }
{ "id": "first-error", "type": "some", "path": "timeline", "match": { "field": "event", "all": ["503|timeout"], "timeField": "time", "timeNear": { "time": "2026-03-17T18:04:00Z", "tolMin": 3 } } }
{ "id": "fence-first", "type": "order", "path": "steps", "first": { "field": "command", "all": ["fence"] }, "then": { "field": "command", "all": ["promote"] } }
{ "id": "gate-metrics-exist", "type": "inSet", "path": "steps", "field": "gate.metric", "fromFile": "metrics/catalogue.csv", "pattern": "^([a-z_]+)," }
```
Paths in `fromFile` and `file` are relative to the folder root the agent works in (no `fixture/` prefix). Do not change anything under `kit/`.
All regexes are JavaScript, case-insensitive, and every regex field (`all`, `none`, `relevant`) is a LIST of strings. A matcher reads only `field`, `all`, `none`, `num`, `timeNear`, `timeIn` and `timeField`; any other key is ignored, so a matcher with only `timeNear` accepts any element at that time. Rules for a fair key:
- A hurried reader who reads only the README and the first 60 lines of each file must not be able to name the true cause, the numbers or the times. Put the proving lines deep inside the large files, and keep small summary files (config diffs, release notes, tickets, to-do lists) neutral or only partly telling.
- The request never states the facts the agent has to find: no host roles, thresholds, metric names, causes, constraints, steps or file list.
- The request never says which suspect is the decoy, and never lists the files or log lines to look at first.
- Each item tests one thing a careful practitioner gets right and a quick answer gets wrong. Most items are substance: the true cause, the numbers, the times, the constraint respected.
- Text patterns accept every reasonable phrasing: use alternations with synonyms (`pool|connections?`), and require two or more patterns where one word could appear in a wrong answer. Use `none` to fail an answer that blames the decoy.
- With `timeNear`, do not also put the time as a literal pattern in `all`: the tolerance must decide. Evidence groups should accept any of the lines that show the same fact (for example every line of one config change).
- Numbers and times must be derivable from the fixture alone; state units in the request; give a tolerance (times 2 to 5 minutes, counts 3 to 10 percent).
- The seeded facts come from the generator, so compute the key values from the generated files with a small script, not by hand.
{{KINDEXTRA}}

Write `solution/` with the reference document at `{{OUTFILE}}` (a real document a senior engineer would write, ending with the block). The tests check is `{ "type": "tests", "cmd": "node --test --test-timeout=15000 block.test.js", "min": <the number of tests: the sum of item weights>, "weight": 3, "kind": "substance" }`. Do not write the grader or `hidden/` yourself; `kit/selfcheck.js` builds it from `blockKey`.
