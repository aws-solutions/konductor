## What the hidden part is: a findings key

The task asks the agent to write a document. A hidden script reads a fenced JSON block at the end of the document (a list of objects with `location`, `severity`, `fix`) and compares it with a key of seeded items. Write, inside `task-draft.json`, one more key `findingsKey`: a list of {{NKEY}} objects `{ "id", "location", "severity", "fix", "weight"?, "fixMin"? }`:
- `location`: a string or list of strings that an agent would use to name the place (file path, module or function name); an item matches when the agent's `location` holds one of them, case-insensitively.
- `severity`: one of critical, high, medium, low.
- `fix`: a list of short keywords; the item's fix counts when the agent's `fix` or `text` holds `fixMin` of them (default 1). Choose keywords that any sensible description of the right test would contain, and several synonyms.
- The seeded items are real risks in the fixture that a careful practitioner finds only by reading the code and the history in it, not from file names or comments. Include {{NTRAP}} that look harmless at first glance, and plant {{NDECOY}} decoys: big or ugly code that is actually low risk, which a quick answer will wrongly flag.
- {{EXTRA}}

Write `solution/` containing the reference document at the path the prompt names, with the JSON block listing every key item plus one or two extra true findings. Do NOT write the grader; it is bench-provided. Do not write `hidden/` for this kind. The prompt must tell the agent the file path and the JSON block format (`location`, `severity` as critical/high/medium/low, `fix` as the test to add), since the hidden script relies on them. No `tests` check is needed in `task-draft.json` here: instead add the check `{ "type": "tests", "cmd": "{{TESTCMD}}", "min": {{TESTMIN}}, "weight": 3, "kind": "substance" }` exactly (the bench builds the hidden tests from your key: 2 per key item plus 1).

Verify: write a tiny script in a scratch folder that reads your `solution` document and the key and checks every key id is found by location and fix keywords. Print its result.
