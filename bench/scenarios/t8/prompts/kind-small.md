## What the hidden part is: a few plain tests

This is a SMALL, CLEAR task: a teammate's one-off ops ask that a competent engineer finishes in a few minutes. No investigation, planning or document is needed, and the request says exactly what to change or answer. It is still realistic: the folder is a real-looking ops repository and the ask is something people really ask.

Write `hidden/hidden-check.test.js` (copied to the repository root before it runs): 6 to 10 tests with node:test and node:assert that check the result the request states (file contents parsed, not grepped, where possible), plus 1 or 2 that check nothing else changed. Deterministic, no network. At most 20% pass on the untouched fixture.
Write `solution/`: the reference overlay (every changed or added file in full).
The tests check is `{ "type": "tests", "cmd": "node --test --test-timeout=15000 hidden-check.test.js", "min": <number of tests>, "weight": 3, "kind": "substance" }`.
