You are writing ONE benchmark task for AI agents. The folder `fixture/` in the current directory is a finished, realistic project that another task already uses. Your task uses the same project with a different request: a writing job where reviewing the work for problems does not help. A hidden script, which the agent never sees, checks the agent's text against a key you write. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything in `fixture/`.

## The brief

{{BRIEF}}

## What to produce

1. `twin-key.json`, exactly this shape:
   ```json
   {
     "output": "{{OUTPUT}}",
     "facts": [ { "id": "f1", "anyOf": ["regex", "regex"], "fact": "one sentence" } ],
     "forbidden": [ { "id": "x1", "pattern": "regex", "why": "one sentence" } ]
   }
   ```
   - 8 to 12 `facts`: things a correct answer must state, read from the project (a name, a number, a date, a behaviour change, an action someone must take). Each `anyOf` holds 2 to 5 JavaScript regular expressions (matched case-insensitively) covering the plain ways a writer would say it, so a correct answer in any wording passes. Avoid patterns that match almost any text.
   - 2 to 4 `forbidden` claims: statements a careless answer would make that are false for this project (a feature it does not add, a wrong number, describing a known gap as solved). Each `pattern` must match only that false claim, never a correct sentence.
2. `solution/{{OUTPUT}}`: the reference answer, written well, as the person asking would want it.
3. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, in the voice of the person who owns the work, 60 to 180 words. It says where the material is and that the text goes to `{{OUTPUT}}` at the top of the project. Do NOT ask for a review, problems, risks or feedback. Do NOT name any method or process. Do NOT tell the agent to ask or not to ask questions. Do not mention keys, scoring or benchmarks.
   - `rubric`: exactly 1 item `{ "id", "criterion", "weight": 2 }` for what code cannot check (for example that the text is accurate and readable for its audience). End the criterion with "(code cannot check this because ...)". Do not reward length or formatting.
   - `limits`: `{ "softSec": number, "hardSec": number }`, softSec between 300 and 900, hardSec twice softSec.
   - `notes`: 2 to 4 short sentences for the human checker.
4. Verify before you finish. The folder `harness/` holds the grader (`twin.test.cjs`); do not change it. In a scratch folder, copy `fixture/`, lay `solution/` over it, copy `harness/twin.test.cjs` and your `twin-key.json` into `scratch/hidden/`, and run `node --test hidden/twin.test.cjs` from the scratch root: every test must pass. Remove `{{OUTPUT}}` and run again: every test must fail. Fix what fails, delete the scratch folder, and print a short list of what you verified.

Keep everything plain, original and free of any company-internal names, host paths, usernames or secrets. Stop when the files are written and verified.
