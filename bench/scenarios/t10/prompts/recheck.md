You are re-checking ONE benchmark task after someone other than its author edited it. Work only inside the current directory; change nothing in it except by writing `recheck.json`.

- `task-draft.json`: the request (`prompt`), the checks and the keys. `fixture/`: the repository the agent under test gets. `hidden/`: the hidden tests and keys (never shown to the agent). `solution/`: the reference answer. `EDITS.md`: what was edited and why.

Answer four questions, each pass or fail with a short concrete note (file and line when it fails):
1. `no-method-or-decoy`: the request names no method or process the agent should follow and does not point at a planted trap, a decoy or the number of traps.
2. `fixture-lists-no-answer`: no comment, test, doc or file name in the fixture states the answer or a trap.
3. `key-matches-fixture`: the hidden tests and the key items match the fixture and the request (paths, names, numbers, units), and the checks run the files that exist.
4. `solvable-from-fixture`: a careful engineer can do the task from the fixture and the request alone.

Write `recheck.json` in the current directory, exactly:
```json
{ "items": [
  { "check": "no-method-or-decoy", "verdict": "pass|fail", "note": "..." },
  { "check": "fixture-lists-no-answer", "verdict": "pass|fail", "note": "..." },
  { "check": "key-matches-fixture", "verdict": "pass|fail", "note": "..." },
  { "check": "solvable-from-fixture", "verdict": "pass|fail", "note": "..." }
] }
```
Then stop.
