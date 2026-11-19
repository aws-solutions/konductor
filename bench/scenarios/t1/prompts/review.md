You are reviewing one benchmark task written by another model. The current directory holds it: `fixture/` (the repository the agent starts in), `hidden/` (hidden tests, copied over the repository root before they run), `solution/` (the reference overlay on the fixture) and `task-draft.json` (the request, checks, rubric, notes). Work only inside the current directory; do not change any of these files. Copy them to a scratch folder if you want to run anything. You have no network.

Check, with evidence, each of these:
- leak: does the request name a method, process or tool the agent should use, or tell it how to work?
- ambiguity: could two competent readers disagree on what the request asks for, or do the hidden tests rely on a name, path, format or behaviour the request does not state?
- hidden-answer: does anything in `fixture/` (comments, docs, tests, stubs, names) reveal the answer or the hidden tests?
- ceiling: is the task too easy (a lazy or naive change passes nearly everything)? Try to think of a small, wrong shortcut and see which tests would catch it.
- floor: is it unfair or impossible (contradictory, depends on things the agent cannot know, flaky or timing-dependent tests, tests that fail for a correct alternative solution)?
- reference: put `fixture/` plus `solution/` in a scratch folder (apply `solution/DELETE.txt` if present), run the existing tests and the hidden tests (run `python3` as Python 3.12 where the task is Python) and confirm every hidden test and every check in `task-draft.json` passes; run the hidden tests on the plain fixture and say how many pass.

Write `review.json` in the current directory: {"verdicts": [{"check": "leak|ambiguity|hidden-answer|ceiling|floor", "verdict": "pass|fail", "note": "one or two sentences with evidence"}], "reference": {"existingTestsPass": true|false, "hiddenPass": "n/m", "fixtureHiddenPass": "n/m", "failingChecks": [..]}, "fixes": ["concrete changes that would repair each failure"]}. Use "fail" only for a real defect. Then stop.
