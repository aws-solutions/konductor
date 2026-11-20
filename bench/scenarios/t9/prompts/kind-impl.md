## What the hidden part is: behaviour tests of a new feature

The task asks the agent to build a feature or change in the repository. The score is the share of hidden tests that pass.

Write `hidden/{{TESTFILE}}`: {{NTESTS}} tests with node:test and node:assert of the behaviour the request states, through the interface the request names. They are independent, deterministic, with no real sleeps (inject or fake time), and no network. They pass on the reference and most fail on the plain fixture. Seed {{NTRAP}} traps a careful front-end developer catches and a quick answer misses (for example: an edge in locale or number handling, an empty or very long input, a state that must reset, a stale value after a rapid second action, escaping of user text, a keyboard path next to the mouse path, a rule that already exists elsewhere in the repository and must be reused rather than copied). Include tests that catch a hard-coded answer.

Write `solution/`: the reference overlay (every changed or added file in full), including new tests of the agent's own kind under `test/`.
The `tests` check is `{ "type": "tests", "cmd": "{{TESTCMD}}", "min": {{TESTMIN}}, "weight": 3, "kind": "substance" }`. Also add a `cmd` check that the repository's own visible suite passes (`node --test test/`).
The request describes what users or callers need, never the file or function to change, except where the hidden tests import it (then name that one path and export).
{{BROWSER}}
