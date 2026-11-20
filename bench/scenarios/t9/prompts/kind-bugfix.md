## What the hidden part is: behaviour tests and a regression check

The repository has ONE real bug that users see. The agent must find it from the symptom, fix it at its root, and add a test that fails on the old code. Seed one decoy: a plausible suspect (an odd-looking but correct piece of code, or a recent change) that the code rules out.

Write `hidden/{{TESTFILE}}`: {{NTESTS}} tests with node:test and node:assert of the behaviour the request states, through the interface the request names. Independent, deterministic, no real sleeps, no network. They pass on the reference and most fail on the plain fixture. Include tests that catch a symptom patch (a fix in one caller that leaves the shared code wrong, a special case for the one example in the request, a swallowed error).

Also write `hidden/regress-kit/config.json`: `{ "cmd": "node --test test/", "timeoutSec": 60 }` (the repository's real test command), and `hidden/regress-kit/original/`: the buggy file or files exactly as in the fixture, at their repository paths. The bench's own regress test (supplied by `kit/selfcheck.js`, never written by you) runs the agent's suite on the fixed code (must pass) and with these files put back (must fail).

Write `solution/`: the reference overlay (every changed or added file in full): the root-cause fix and one new regression test in `test/`.
The `tests` check is `{ "type": "tests", "cmd": "{{TESTCMD}}", "min": {{TESTMIN}}, "weight": 3, "kind": "substance" }`. Also add a `cmd` check that the visible suite passes (`node --test test/`).
The request names the symptom a user sees and how to reproduce it, never the file or function at fault.
{{BROWSER}}
