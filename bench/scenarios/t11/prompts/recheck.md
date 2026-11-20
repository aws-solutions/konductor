You are re-checking one benchmark task after someone other than its author edited it. The current directory holds the task: `fixture/` (the folder the agent starts in; `fixture/dotgit`, when present, is its git repository), `hidden/` (the hidden tests), `solution/`, `alt/`, `lazy/`, `task-draft.json` (the request in `prompt`, the checks) and `kit/`. Images and documents in `fixture/` are inputs the agent must read; open them. Work only inside the current directory and change nothing. You have no network.

The edit: {{EDIT}}

Answer each item of this checklist with evidence from the files:
1. no-method-or-decoy: the request names no method and no decoy.
2. fixture-lists-no-answer: the fixture does not list the answers.
3. key-matches-fixture: the hidden tests (or key) match the fixture.
4. solvable-from-fixture: the task can be solved from the fixture and the request alone.

Write `recheck.json` in the current directory: {"items": [{"check": "no-method-or-decoy|fixture-lists-no-answer|key-matches-fixture|solvable-from-fixture", "verdict": "pass|fail", "note": "one or two sentences with evidence"}]}. Use "fail" only for a real defect. Then stop.
