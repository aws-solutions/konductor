You are reviewing one benchmark task written by another model. The current directory holds it: `fixture/` (the folder the agent starts in; `fixture/dotgit`, when present, is its git repository, renamed to `.git` when the bench copies it), `hidden/` (the hidden tests, laid over the folder root before they run; `block-kit/key.json`, when present, is a key read from a JSON block of the agent's document), `solution/` (the reference answer), `alt/` and `lazy/` (a second correct answer and a shallow one; a folder holding `APPLY.sh` is a script that does git work), `task-draft.json` (the request, checks, rubric, notes) and `kit/`. Work only inside the current directory; do not change any of these files. You have no network.

Check, with evidence, each of these:
- leak: does the request name a method, process or tool the agent should use, tell it how to work, or list the traps it should find?
- ambiguity: could two competent readers disagree on what the request asks for, or do the hidden tests rely on a path, name, format or behaviour the request does not state?
- hidden-answer: does anything in `fixture/` (comments, docs, tests, names, changelog, commit messages) reveal the answer or the hidden tests?
- ceiling: is the task too easy? Think of a quick, wrong answer and say which tests would catch it.
- floor: is it unfair or impossible (a test that fails for a correct alternative, a timing-dependent test, something that cannot be derived from the folder, an image or document the key misreads)? Read the tests one by one against the request.
- reference: run `node kit/selfcheck.js` and report the estimated scores of the reference, the plain fixture, `alt/` and `lazy/`.

Write `review.json` in the current directory: {"verdicts": [{"check": "leak|ambiguity|hidden-answer|ceiling|floor", "verdict": "pass|fail", "note": "one or two sentences with evidence"}], "reference": {"scores": {...}, "failingChecks": [..]}, "fixes": ["concrete changes that would repair each failure"]}. Use "fail" only for a real defect. Then stop.
