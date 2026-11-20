You are writing ONE benchmark task for AI agents that do program and project management work. The agent under test gets a folder of realistic inputs (ticket exports, a roadmap, capacity sheets and the like) and a request written the way a busy director would write it. A hidden script, which the agent never sees, reads one structured block in the agent's document and scores it against a key. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh: all names, teams, tickets and numbers are invented. Copy nothing from any public project.

## The brief

- Task id: `{{ID}}`
- Phase and role: {{PHASE}}, {{ROLE}}
- Inputs: {{KIND}}
- Situation: {{SCENARIO}}
- Traps to seed (a careful practitioner catches them, a quick answer misses them): {{SEEDS}}
- Public inspiration, idea only (do not quote it): {{SOURCE}}
- The agent writes `{{OUTPUT}}`, a document for the requester, holding one fenced JSON block whose info string is `{{BLOCK}}` (a line with three backticks and `{{BLOCK}}`, the JSON, then three backticks). Its shape: {{SHAPE}}
{{TWIN}}
## What to produce

Write these into the current directory. `hidden/plan-grade.cjs` and `hidden/plan.test.cjs` are already here: the grader and the hidden test. Read `hidden/plan-grade.cjs` first; its header lists the assertion ops you can use. Do not change either file.

1. `fixture/`: the folder the agent starts in. It must look like a real team's working folder: 8 to 25 files (more for a code repository), with a README that says what each file is, what the columns mean and the "as of" date that counts as today. Use dates in 2027. Vary sizes; include the noise real exports have (closed tickets, cancelled ones, odd spellings, empty cells, comments).
   - Generate the bulk data with a deterministic script, `authoring/generate.py` (Python 3.12 standard library only, fixed random seed), then plant the traps on top. Keep `authoring/` outside `fixture/`; the agent never sees it.
   - Nothing in the fixture may hint at a trap or at the answer: no note that names the critical path, no column that flags a conflict, no "risk" label on the seeded tickets, no leftover from the answer. Planted tickets take ids from the ordinary sequence, scattered among the others (never a block such as 900 to 999 or the last rows of the file), and carry the same kind of titles and comments as ordinary tickets.
   - Where an honest answer depends on a data convention (which statuses count as open, how a holiday counts against capacity, what a sprint's dates are, whether blank estimates count, how names are matched), state it plainly in the fixture's docs so that one right answer exists. Never describe how to do the analysis: no definition of the longest chain, of a date conflict, of scope added after lock, or of how to turn points into a date. Finding and computing those is the agent's job.
2. `authoring/compute_key.py`: reads ONLY files under `fixture/` and computes every id, date and number the key needs (for example the longest dependency chain, capacity per sprint after holidays, points added after a date). It writes `hidden/key.json`. The key must follow from the data by this code, not from your memory of what you planted.
3. `hidden/key.json`: `{"output": "{{OUTPUT}}", "block": "{{BLOCK}}", "assertions": [...]}`. Each assertion is `{"id", "desc", "op", ...op fields}` with an op from `hidden/plan-grade.cjs`. Rules:
   - 12 to 20 assertions. Every seeded trap has at least one. Every decoy has an `absent` (or `excludes`) assertion. A list of risks, blockers or conflicts gets one `precision` assertion over the union of the key's ids, with a `maxCount` of about 1.5 times the seeded count plus 2, so a padded list does not win.
   - Dates use `tolDays` and numbers use `tol` or `tolPct` wide enough for the defensible ways of computing them (state the convention in the fixture to keep the width small), and no wider. A number or date that a lazy method gets wrong must fall outside the tolerance.
   - Assert only keys that the shape above names, so the request can state every key the script reads.
   - Do not make many assertions hang on one detail; one slip should fail only one or two.
   - Never address a list element by position (`risks.1.kind`): the agent may order its list any way. To check a field of the element that names a ticket, use `cites` with `where` (for example `{"op": "cites", "path": "risks", "field": "tickets", "ids": ["X-12"], "where": {"kind": "date-conflict"}}`).
   - Where several methods a strong practitioner might use give different dates or counts (for example finishing only the longest chain against finishing all remaining launch work), set the tolerance to cover them all and to exclude what a lazy reading gives.
   - Check facts in the data, never the answer's own wording or naming: no assertion on an id, name or label the agent invents (its risk ids, workstream or milestone names), no exact match on a free-text field, no `order` between items that may sit in the same group, and no assertion that only echoes a value the request itself states.
4. `solution/`: the reference answer as an overlay on the fixture: `solution/{{OUTPUT}}`, written as the real deliverable a strong practitioner would send (plain words, the reasoning and numbers a director needs, honest about uncertainty), with the block. It must pass every assertion.
5. `task-draft.json`, one JSON object with exactly these keys:
   - `prompt`: the request, in the requester's voice. Plain words, 60 to 200 words. Say what they want and why, name the file `{{OUTPUT}}`, and give the block's info string and every key and allowed value of its shape, as a plain format note (the block is how their tooling reads the answer). Do NOT name any method, framework or process (no "critical path method", "Monte Carlo", "RACI", "MoSCoW", "risk matrix", "write a plan first"). Do NOT hint at any trap. Do NOT tell the agent to ask or not to ask questions. Do not mention hidden scripts, scoring or benchmarks. The agent's folder is not called `fixture`: say "this folder" or name the files.
   - `rubric`: 1 or 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check (for example whether the prose tells the requester the honest bottom line first, or whether the reasoning behind a number is shown). Each criterion ends with "(code cannot check this because ...)". Do not reward length or formatting.
{{EXPERT}}   - `limits`: `{ "softSec": number, "hardSec": number }`: the time a competent agent needs (300 to 900 s); hardSec is twice softSec.
   - Use dates and weekdays that agree: sprints start and end on the weekdays the docs say, holidays fall on real working days of 2027.
   - `dataFile`: the path, relative to `fixture/`, of the main input file the agent must not change.
   - `notes`: 3 to 6 short sentences for the reviewer: each trap, the lazy answer it catches, and the decoy.
6. Verify before you finish, in a scratch folder inside the current directory (delete it afterwards):
   - copy `fixture/`, overlay `solution/`, copy `hidden/` in, and from that folder run `node --test --test-timeout=15000 hidden/plan.test.cjs`: every test must pass;
   - do the same with the bare `fixture/` (no solution): every test must fail;
   - write a lazy answer as `lazy/{{OUTPUT}}` (an overlay like `solution/`, kept in the current directory): plausible and shallow, it takes the obvious reading (trusts the status column, counts every ticket, uses the roadmap's date, names the decoy), has the block in the right shape and uses the right words; it must fail at least 60% of the tests;
   - rerun `authoring/compute_key.py` and confirm `hidden/key.json` is unchanged.
   Then print a short list of what you verified, with the pass counts.

Keep everything plain, original and free of any company names, internal tool names, host paths, usernames or secrets. Stop when the files are written and verified.
