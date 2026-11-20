## What the hidden part is: behaviour that must not change, and the structure that must

The task asks the agent to restructure working code without changing what it does. The score is the share of hidden tests that pass.

Write `hidden/{{TESTFILE}}`: {{NTESTS}} tests with node:test and node:assert. About two thirds are characterization tests of the public behaviour through the repository's existing entry points (they pass on the plain fixture AND on the reference, so they also protect against a broken refactor). The rest are structure tests that fail on the plain fixture and pass on the reference: they import the new modules the request names (name the paths and exports in the request) and check that they work on their own, that the old entry points still exist, and that the old entry points use the new ones (for example by injecting a fake dependency, never by reading source text). Seed {{NTRAP}} behaviours that a careless restructure breaks (hidden coupling through module state, call order, a quirk that callers depend on, an error type, a default value).

Write `solution/`: the reference overlay (every changed or added file in full). Existing visible tests must still pass.
The `tests` check is `{ "type": "tests", "cmd": "{{TESTCMD}}", "min": {{TESTMIN}}, "weight": 3, "kind": "substance" }`. Also add a `cmd` check that the visible suite passes (`node --test test/`). The characterization tests that pass on the plain fixture count toward the score, so keep them at most one third of the tests.
{{BROWSER}}
