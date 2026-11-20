You are re-checking one benchmark task after someone other than its author edited it. The current directory holds `task.json` (the task: the request in `prompt`, its checks, rubric and any `expertKey`), `fixture/` (the repository the agent starts in), `hidden/` (hidden tests, copied over the repository root before they run) and `solution/` (the reference change). `edits.md` says what was edited and why. Work only inside the current directory and change none of these files. You have no network.

Answer four questions, each with evidence from the files:
1. no-method-or-decoy: the request names no method, process, framework or tool for how to work, and holds no misleading hint (a decoy) that points away from the real problem.
2. fixture-lists-no-answer: nothing in `fixture/` (comments, docs, tests, names) lists the answer or describes the finished behaviour the hidden tests check.
3. key-matches-fixture: the hidden tests and the expert key (if any) match the fixture and the request: every name, path, format and behaviour they rely on exists in the fixture or is stated in the request.
4. solvable-from-fixture: a competent developer could solve the task from the fixture and the request alone, without seeing the hidden tests or the solution.

Write `recheck.json`: {"items": [{"check": "no-method-or-decoy" | "fixture-lists-no-answer" | "key-matches-fixture" | "solvable-from-fixture", "verdict": "pass" | "fail", "note": "one or two sentences of evidence"}]}, one item per question. Use "fail" only for a real defect. Then stop.
