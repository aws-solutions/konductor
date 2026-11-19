## What the hidden part is: behaviour tests and a regression check

The fixture is a small service repository with an `ops/` folder of production evidence (logs, a metrics CSV, a deploy history, an alert that fired). One real bug in the code explains the evidence; the agent must find it from the evidence, fix it at its root, and add a test that fails on the old code. Seed one decoy in the evidence: a plausible suspect the logs rule out.

Write `hidden/`, laid out relative to the repository root (copied over it before the tests run):
- `hidden/hidden-behaviour.test.js`: 8 to 14 tests with node:test and node:assert of the behaviour the request states, through the module's public interface. Independent, deterministic, no real sleeps (inject or fake the clock and timers), no network. They pass on the reference fix, and most fail on the fixture. Include tests that catch a symptom patch (a fix at the call site that leaves the shared code wrong, a raised limit, a swallowed error).
- `hidden/regress-kit/config.json`: `{ "cmd": "node --test test/", "timeoutSec": 60 }` (use the repository's real test command).
- `hidden/regress-kit/original/`: the buggy file or files exactly as in the fixture, at their repository paths. The bench's `regress.test.js` runs the agent's suite on the fixed code (must pass) and with these files put back (must fail).

Write `solution/`: the reference overlay (every changed or added file in full): the root-cause fix and one new regression test in `test/`.
The tests check is `{ "type": "tests", "cmd": "node --test --test-timeout=60000 hidden-behaviour.test.js regress.test.js", "min": <behaviour tests + 1>, "weight": 3, "kind": "substance" }`. Also add a `cmd` check that the visible suite passes (`node --test test/`).
The request names the symptom the users see and where the evidence is (`ops/`), never the file or function at fault.
