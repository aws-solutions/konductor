You are re-checking ONE benchmark task after someone other than its author edited it. The current directory holds it: `fixture/` (the repository the agent starts in), `hidden/` (the hidden tests, copied over the repository root before they run), `solution/` (the reference overlay), `task-draft.json` (the request in `prompt`, and the checks) and `edits.md` (what was edited and why). Work only inside the current directory and change none of these files. You have no network.

Answer four questions, each pass or fail with a short concrete note (file and line when it fails):
1. `no-method-or-decoy`: the request names no method, tool or process for how to work, and does not point at a planted trap, a decoy or the number of problems.
2. `fixture-lists-no-answer`: no comment, test, doc or file name in the fixture states the answer or a hidden test.
3. `key-matches-fixture`: every hidden test and check matches what the request states and what the fixture contains (paths, exports, labels, field names), and the reference passes them.
4. `solvable-from-fixture`: a careful developer can pass every hidden test from the request and the fixture alone.

Write `recheck.json` in the current directory, exactly:
{ "items": [
  { "check": "no-method-or-decoy", "verdict": "pass|fail", "note": "..." },
  { "check": "fixture-lists-no-answer", "verdict": "pass|fail", "note": "..." },
  { "check": "key-matches-fixture", "verdict": "pass|fail", "note": "..." },
  { "check": "solvable-from-fixture", "verdict": "pass|fail", "note": "..." }
] }
Then stop.
