You are reviewing one benchmark task written by another model. The current directory holds it: `fixture/` (the repository the agent starts in), `hidden/` (the hidden scorer, copied over the repository root before the tests run; `block-kit/key.json` is the design key and `rollout-kit/key.json` the rollout key, `block-kit/block-key.js` the grader), `solution/` (the reference overlay on the fixture), `task-draft.json` (the request, checks, keys, notes) and `kit/selfcheck.js`. Work only inside the current directory; do not change any of these files. You have no network.

Check, with evidence, each of these:
- leak: does the request name a method, process or tool the agent should use, tell it how to work, or list the traps, causes or constraints it should find?
- ambiguity: could two competent readers disagree on what the request asks for, or do the tests or keys rely on a path, name, field, unit or format the request does not state?
- hidden-answer: does anything in `fixture/` (notes, docs, comments, file names) give away a trap, the design the keys expect, or the keys?
- ceiling: is the task too easy? Think of a quick answer (it builds the obvious feature, skims the docs, writes a generic design note and a generic rollout plan) and say which tests or key items would catch it.
- floor: is it unfair or impossible (a test that needs a behaviour the request does not state, a key value that cannot be derived from the fixture, a text pattern that rejects a correct phrasing, a test that fails for a correct alternative implementation)? Read the tests and key items one by one against the fixture and the request.
- reference: run `node kit/selfcheck.js` and report the numbers it prints.

Write `review.json` in the current directory: {"verdicts": [{"check": "leak|ambiguity|hidden-answer|ceiling|floor", "verdict": "pass|fail", "note": "one or two sentences with evidence"}], "reference": {"estimatedScores": {...}, "failingChecks": [..]}, "fixes": ["concrete changes that would repair each failure"]}. Use "fail" only for a real defect. Then stop.
