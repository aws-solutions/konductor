You are re-checking ONE benchmark task after someone other than its author edited it. Work only inside the current directory; change nothing under `task/`.

- `task/prompt.txt`: the request the agent under test gets.
- `task/fixture/`: the project the agent gets.
- `task/key.json` (or `task/twin-key.json`): the hidden key the agent's output is graded against.
- `task/solution/`: the reference answer.
- `task/edits.md`: what was edited and why.

Answer four questions, each pass or fail with a short concrete note (file and line or section when it fails):
1. `no-method-or-decoy-in-prompt`: the prompt names no review method, checklist or process, and does not point at a planted problem, a decoy or the number of problems.
2. `fixture-does-not-list-answers`: no comment, test, doc or file name in the fixture states a planted problem.
3. `key-matches-fixture`: every key item's file and line (or section number) is where the problem is, and its severity is defensible.
4. `solvable-from-fixture`: a careful reviewer can find every key item from the fixture alone.

Write `recheck.json` in the current directory, exactly:
```json
{ "items": [
  { "item": "no-method-or-decoy-in-prompt", "verdict": "pass|fail", "note": "..." },
  { "item": "fixture-does-not-list-answers", "verdict": "pass|fail", "note": "..." },
  { "item": "key-matches-fixture", "verdict": "pass|fail", "note": "..." },
  { "item": "solvable-from-fixture", "verdict": "pass|fail", "note": "..." }
] }
```
Then stop.
