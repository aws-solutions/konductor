## What the hidden part is: behaviour tests

The score is the share of hidden tests that pass after the agent's work.

Write `hidden/hidden-behaviour.test.js` (laid over the repository root before it runs): {{NTESTS}} tests with node:test and node:assert of the behaviour the request states, through the interface the request names or the repository already exposes. They are independent and deterministic, with no real sleeps and no network. Any git command a test runs uses `execFileSync('git', [...], { cwd: <repository root> })`; the root is the test file's own folder. They pass on the reference and most fail on the plain fixture. Seed {{NTRAP}} traps that a careful developer catches and a quick answer misses. Include tests that catch a hard-coded answer and a change made in only some of the places that need it.

Write `solution/`: the reference answer (every changed or added file in full, or `APPLY.sh` for git work), including new tests of the agent's own kind under `test/` when the request asks for code.
The `tests` check is `{ "type": "tests", "cmd": "node --test --test-timeout=30000 hidden-behaviour.test.js", "min": <the exact number of tests>, "weight": 3, "kind": "substance" }`. Also add a `cmd` check that the repository's own visible suite passes (`node --test test/`).
