## The hidden part

Hidden checks, which the agent never sees, score three things: the built feature (behaviour tests), the design note and the rollout plan (each a key over its closing JSON block), plus a few other checks. A judge later scores only the design's judgment, from an expert key you also write.

### 1. Behaviour tests of the feature

Write `hidden/hidden-behaviour.test.js` (laid over the repository root before it runs): {{NTESTS}} tests with node:test and node:assert of the behaviour the request promises, through only the interfaces the request names and the repository's existing public modules. Independent, deterministic, no real sleeps (fake or inject the clock), no network, each under 2 seconds. They all pass on the reference; on the plain fixture at most 10% pass. Cover the traps: a boundary, a concurrency or ordering case, old stored data, units or time zones, and a test that catches a symptom patch (a check in the caller that leaves the shared code wrong). A correct alternative implementation that keeps the stated interfaces must pass.

### 2. The design note key and the rollout plan key

The design note and the rollout plan each end with a fenced ```json block of one JSON object, which the request describes. A bench-provided script (`kit/block-key.js`, read its header for the exact rules) grades each block against a key you write, with no model. Put the keys in `task-draft.json` as `designKey` and `rolloutKey`: `{ "outputFile": "<the document path the request names>", "items": [ ... ] }`. `designKey` has {{NDESIGN}} items and `rolloutKey` has {{NROLLOUT}} items. Each item has `id`, `type`, an optional `weight` (1 to 3) and the fields of its type:
- `text` {path, all, none}: the value at a dotted path, as text, matches every regex in `all` and none in `none`.
- `some` / `none` / `every` {path, match}: list elements matching a matcher `{field?, all?, none?, num?: {gt, gte, lt, lte}}`.
- `order` {path, first, then}: the first element matching `first` comes before the first matching `then`.
- `number` {path, value, tol | tolPct}: a number within the tolerance.
- `maxLen` {path, max, min}: list length bounds (a precision term: a list that names everything does not win).
- `inSet` {path, field, fromFile, pattern}: every value of `field` is one of the names a fixture file defines (for example every metric a rollout gate uses exists in the metrics catalogue; every ring named exists in the rings file).
- `evidence` {path, groups: [{all, file}], min}: cited `path:line` refs must hit lines whose text matches each group's regexes.
Example items, exactly in this shape (every item has an `id`; a matcher is one flat object):
```
{ "id": "reuses-lock", "type": "text", "path": "decisions", "all": ["lock|mutex|serializ", "withLock|store"], "weight": 2 }
{ "id": "gate-metrics-exist", "type": "inSet", "path": "phases", "field": "gate.metric", "fromFile": "ops/metrics.csv", "pattern": "^([a-z_.]+)," }
{ "id": "ring-order", "type": "order", "path": "phases", "first": { "field": "audience", "all": ["internal"] }, "then": { "field": "audience", "all": ["all|everyone"] } }
```
Paths in `fromFile` and `file` are relative to the repository root (no `fixture/` prefix). All regexes are JavaScript, case-insensitive, and every regex field (`all`, `none`) is a LIST of strings. A matcher reads only `field`, `all`, `none` and `num`; any other key is ignored. Rules for a fair key:
- Each item tests one thing a careful practitioner gets right and a quick answer gets wrong. Most items are substance: a decision that respects a planted fact, a risk named with its real cause, a gate on a metric that exists, a rollback that undoes what the build changed, an order that matters.
- Text patterns accept every reasonable phrasing: use alternations with synonyms and require two or more patterns where one word could appear in a wrong answer. Use `none` to fail an answer that falls for a trap.
- Numbers must be derivable from the fixture; state units; give a tolerance.
- A hurried reader who skims the README must not be able to pass the traps: the proving facts sit in the existing code, config and docs, not in summary files.
- `evidence` items cite only lines of files the reference solution does NOT change (a changed file shifts line numbers), and each group accepts every line that shows the same fact.
- A list whose order matters (phases, steps, rings) sits under a field whose name contains `phases`, `steps` or `rings`, and an `order` item tests it; the bench's alternative-answer writer reverses every other list and rewords free text, so no other list may depend on order, and items must pass a reworded answer.
- The design keys do not duplicate the expert key below.

### 3. Expert key (for judges only)

`expertKey` in `task-draft.json`: `{ "items": [ { "id": "e1", "text": "...", "source": "..." } ], "weakAnswers": ["...", "...", "..."] }`.
- {{NEXPERT}} `items`: the risks, trade-offs, constraints and failure modes a strong design note for THIS feature raises, that the scripted keys above do not already check. Each `text` is one sentence a judge can check against the note ("Explains what happens to accounts already above the limit when the feature turns on"). Each `source` names the public source the idea comes from, from this list only: `https://sre.google/sre-book/table-of-contents/ (CC BY-NC-ND 4.0)`, `https://12factor.net (MIT)`, `https://github.com/kubernetes/enhancements (Apache-2.0)`, `https://github.com/adr/madr (MIT OR CC0-1.0)`, `https://cheatsheetseries.owasp.org (CC BY-SA 4.0)`, or the brief's own source. Take the idea only; quote nothing.
- 3 to 5 `weakAnswers`: what a shallow design note would say (generic praise, "consider scalability", restating the request).

### 4. The reference solution

Write `solution/`: the reference overlay on the fixture (every changed or added file in full): the feature in `src/`, new tests in `test/`, the CI change if any, the design note, the rollout plan and the CHANGELOG entry, written as a senior engineer would. Both documents end with the JSON block described in the request. The documents are real documents (short prose with reasons), not just the block.

### 5. The task file

Write `task-draft.json`, one JSON object with exactly these keys:
- `id`: `{{ID}}`
- `prompt`: the request, as the fixture part describes.
- `checks`: executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd`, `min`), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools and `node` may be used in `cmd` (no python: the check machine may not have it; use `node -e` for any script). Exactly these three `tests` checks (weight 3, kind substance):
  - `{ "type": "tests", "cmd": "node --test --test-timeout=60000 hidden-behaviour.test.js", "min": <number of behaviour tests> }`
  - `{ "type": "tests", "cmd": "node --test --test-timeout=15000 block.test.js", "min": <sum of the design item weights> }`
  - `{ "type": "tests", "cmd": "BLOCK_KIT=rollout-kit node --test --test-timeout=15000 block.test.js", "min": <sum of the rollout item weights> }`
  Add 3 to 5 other checks the hidden tests do not cover: both documents exist (`file_exists`); the visible suite passes AND the agent added tests (one `cmd`: run `node --test` and compare the number of `test(` or `it(` lines under `test/` with the fixture's count, at least {{NNEWTESTS}} more); the CHANGELOG has a new entry (a `cmd` check that compares with the fixture); one file the agent must not edit is unchanged (`fixture_unchanged`, weight 1). Substance weights 1 to 3. At most 25% of the substance weight of the non-`tests` checks may belong to checks that already pass on the untouched fixture. Paths are relative to the repository root. No `contains` check may test a loose keyword that a wrong answer would also contain. Every check must pass on `fixture` plus `solution` plus `hidden`.
- `rubric`: `[]` (the expert key is scored by judges; the stage adds its rubric item).
- `designKey`, `rolloutKey`, `expertKey`: as above.
- `limits`: `{ "softSec": 2400, "hardSec": 4800 }`.
- `notes`: 4 to 8 short sentences for the reviewer: the traps you built in, what a quick answer would get wrong, what the reference does.

## Finish

Run `node kit/selfcheck.js` (it builds `hidden/` from your draft, runs every `tests` check on fixture plus solution and on the plain fixture, and prints the estimated code score of each). Gates: every test passes on the reference (estimate 95 or more), the plain fixture estimates 20 or less. Fix what fails and run it again. Then print a short list of what you verified. Keep everything plain, original and free of internal names, real company names, host paths, usernames or secrets. Stop when the files are written and verified.
