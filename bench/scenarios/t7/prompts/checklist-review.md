You are reviewing one benchmark task. The current directory holds `fixture/` (the folder the agent gets), `task-draft.json` (its `prompt` is the request), `hidden/key.json` (the answer key the hidden grader `hidden/plan-grade.cjs` applies to the block in the agent's answer) and `solution/` (the reference answer). Do not change any file. Work only inside the current directory; you have no network. Copy files to a scratch folder inside the current directory if you want to run anything, and delete it afterwards.

Answer these four checks with evidence:
1. `no-method-or-decoy`: the prompt names no method, framework or process, names no decoy, and does not list what to look for.
2. `fixture-lists-no-answer`: no file in `fixture/` states an answer, a trap, a decoy or how to analyse the data (comments, labels, column names, README sentences).
3. `key-matches-fixture`: re-derive at least three key values (ids, numbers or dates) yourself from `fixture/` under its README's conventions, without reading any script; they match the key within its tolerance.
4. `solvable-from-fixture`: every fact the key checks can be found from `fixture/` alone.

Write `recheck.json`: `{"items": [{"check": "no-method-or-decoy|fixture-lists-no-answer|key-matches-fixture|solvable-from-fixture", "verdict": "pass|fail", "note": "one or two sentences with evidence"}]}`, one item per check. Use "fail" only for a real defect. Then stop.
