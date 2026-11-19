You are reviewing ONE benchmark task written by another model. Work only inside the current directory; do not change any file except `review.json`. You have no network.

The folder holds: `fixture/` (what the agent under test starts with), `hidden/` (tests the agent never sees), `solution/` (the reference answer; `solution/ASKS.json`, when present, lists the questions a good agent would ask), `task-draft.json` (the request in `prompt`, the checks, and for some tasks `scriptedUser`: facts a simulated colleague reveals only when the agent asks about their topics), and `kit/check-draft.js` (scores the reference and a do-nothing stub; run it with `node kit/check-draft.js`).

Check these five things and give each a verdict "pass" or "fail" with a one or two sentence note:
1. `leak`: does the request tell the agent HOW to work (name a method, framework, template or process, or say to ask or not ask questions), rather than only what outcome is wanted?
2. `ambiguity`: could a competent person read the request and the folder and be unsure what to deliver, or deliver something reasonable that the hidden tests fail? Look for tests that need a name, path or field the request does not give, and regexes so strict that a correct answer in other words fails.
3. `ceiling`: is the task so easy that a quick answer would score near full marks? For tasks with `scriptedUser`: could the facts be guessed or found in the fixture without asking?
4. `floor`: is the task impossible or unfair, for example a fact no reasonable question would unlock (check each fact's `topics` against how a person would ask), or a test that the reference itself fails?
5. `hidden-answer`: does the fixture or the request contain the answer key, a scripted fact, or a note that tells the agent what to look for?

Also run `node kit/check-draft.js` and report the reference and stub scores it prints.

Write `review.json`: {"verdicts": [{"check": "leak", "verdict": "pass", "note": "..."}, ... all five ...], "referenceScore": N, "stubScore": N, "fixes": ["short concrete fix", ...]}. Keep notes factual and short. Then stop.
