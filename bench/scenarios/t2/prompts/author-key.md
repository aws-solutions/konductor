You are writing the hidden grading key for ONE benchmark task for AI agents that review work. Someone else already wrote the project and the request. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything in `fixture/` or `task-draft.json`.

- `fixture/`: the project the agent under test gets.
- `task-draft.json`: the request the agent gets (its `prompt`).
- `PLANTED.md`: the author's description of each planted problem and each decoy.

Check every paragraph of `PLANTED.md` against the fixture yourself. Keep only problems that are really there, at the place named; correct a line number or section when the author was off, and leave out a problem you cannot see in the fixture or that is the same problem as another one. Then write:

1. `key.json`, exactly this shape:
   ```json
   {
     "output": "REVIEW.md",
     "items": [
       {{ITEMSHAPE}}
     ],
     "decoys": [ {{DECOYSHAPE}} ]
   }
   ```
   - One item per real planted problem. `severity` is one of critical, high, medium, low, nit: the severity a seasoned reviewer would give in this project.
   - `fix`: 2 to 5 short lowercase words or phrases; a correct fix description contains at least one of them. Use plain words a reviewer would write, with common synonyms as separate entries. Never a word that appears in every comment.
   - `finding`: one sentence saying what is wrong and why it matters.
   {{DECOYRULE}}
2. `solution/REVIEW.md`: the reference review, written as a strong reviewer would: short prose on the overall verdict and the most important risks, then the findings. It must end with ONE fenced `json` block holding a list of objects `{ "location", "severity", "issue", "fix" }`, one per key item and nothing else, with `location` written as {{LOCFORMAT}}.
{{EXPERT}}
3. Verify before you finish. The folder `harness/` holds the grader (`findings.test.cjs`, `findings-key.cjs`); do not change it. In a scratch folder INSIDE the current directory (`./scratch`), copy `fixture/`, lay `solution/` over it, copy `harness/findings.test.cjs`, `harness/findings-key.cjs` and your `key.json` into `scratch/hidden/`, and run `node --test hidden/findings.test.cjs` from the scratch root: every test must pass. Then remove `REVIEW.md` from the scratch copy and run it again: every test must fail. Fix what fails, delete the scratch folder, and print a short list of what you verified and which PLANTED.md paragraphs you changed or left out, and why.

Keep everything plain, original and free of any company-internal names, host paths, usernames, emails or secrets. Stop when the files are written and verified.
