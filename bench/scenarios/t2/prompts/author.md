You are writing ONE benchmark task for AI agents that review work. The agent under test gets a small realistic project and a request written the way a busy lead would write it. A hidden script, which the agent never sees, compares the agent's findings with a key of problems you planted. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh; copy nothing from any public repository or document.

## The brief

{{BRIEF}}

## What to produce

Write these into the current directory:

1. `fixture/`: what the agent starts with. It must look real and lived in.
{{FIXTURE}}
   - Nothing in the fixture may point at a planted problem: no TODO, FIXME or comment that names it, no test or doc that describes it as a problem, no file named after it. The author of the change believes it is correct and says so.
   - Plant problems a careful senior reviewer catches and a quick skim misses. At least half of them need reading more than one file (a contract stated in another module, a limit in a config or doc, a caller that relies on old behaviour, numbers in another document). Mix in the ordinary noise of real work (naming, small style points) that is NOT in the key.
2. `key.json`: the planted problems, exactly this shape:
   ```json
   {
     "output": "REVIEW.md",
     "items": [
       {{ITEMSHAPE}}
     ],
     "decoys": [ {{DECOYSHAPE}} ]
   }
   ```
   - {{ITEMCOUNT}} items. `severity` is one of critical, high, medium, low, nit; spread them (at least one critical or high, at least two medium or lower). Use the severity a seasoned reviewer would give, given the real impact in this project.
   - `fix`: 2 to 5 short lowercase words or phrases; a correct fix description contains at least one of them. Use plain words a reviewer would write, with common synonyms as separate entries (for example `"parameter"`, `"placeholder"`, `"prepared"`). Never a word that appears in every comment.
   - `finding`: one sentence saying what is wrong and why it matters, for the human reviewer of this task.
   {{DECOYRULE}}
3. `solution/REVIEW.md`: the reference review, written as a strong reviewer would: short prose on the overall verdict and the most important risks, then the findings. It must end with ONE fenced `json` block holding a list of objects `{ "location", "severity", "issue", "fix" }`, one per planted item and nothing else, with `location` written as {{LOCFORMAT}}.
4. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, in the voice of the lead who owns the work. Plain words, 80 to 220 words. Say what is being reviewed, what they worry about or why it matters now, and where the change or document is. It must say: write the review to `REVIEW.md` at the top of the project, and end it with a fenced json list of findings, each with `location` ({{LOCFORMAT}}), `severity` (critical, high, medium, low or nit), `issue` and `fix`. Do NOT name any review method, checklist, framework or process (no "threat model", "STRIDE", "OWASP", "checklist", "step by step", "be thorough", "consider security, performance..."). Do NOT hint at any planted problem or its area. Do NOT give a count of problems. Do NOT tell the agent to ask or not to ask questions. Do not mention hidden keys, scoring or benchmarks.
   - `rubric`: exactly 1 item `{ "id", "criterion", "weight": 2 }` for what code cannot check, for example whether each important finding explains the concrete consequence in this project and a fix a developer can act on, without invented problems. End the criterion with "(code cannot check this because ...)". Do not reward length or formatting.
   - `limits`: `{ "softSec": number, "hardSec": number }`: the time a competent reviewer agent needs, hardSec twice softSec, softSec between 600 and 1200.
   - `notes`: 3 to 6 short sentences for the human checker: the traps, what a quick review would miss, and which items need cross-file reading.
5. Verify before you finish. The folder `harness/` holds the grader (`findings.test.cjs`, `findings-key.cjs`); do not change it. In a scratch folder, copy `fixture/`, lay `solution/` over it, copy `harness/findings.test.cjs`, `harness/findings-key.cjs` and your `key.json` into `scratch/hidden/`, and run `node --test hidden/findings.test.cjs` from the scratch root: every test must pass. Then remove `REVIEW.md` from the scratch copy and run it again: every test must fail. {{EXTRAVERIFY}}Fix what fails, delete the scratch folder, and print a short list of what you verified.

Keep everything plain, original and free of any company-internal names, host paths, usernames, emails or secrets (fake keys must look obviously fake, like `test_key_123`). Stop when the files are written and verified.
