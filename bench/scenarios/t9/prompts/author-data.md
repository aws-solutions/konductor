You are writing the first half of ONE benchmark task for AI coding agents: the repository and the request. The agent under test receives a small, realistic front-end repository and a request written the way a busy teammate would write it. A separate step, not you, writes the hidden checks later from your files. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh: invent the product, names, copy and data. Copy nothing from any public repository.

## The brief

{{BRIEF}}

## Fixture rules

Write `fixture/`, the repository the agent starts in. It must look like a real, lived-in project.
- {{SIZE}} files. Source, existing tests that pass today, a CI config (`.github/workflows/ci.yml`), a README, a docs folder, a changelog, a package file, realistic data or config files. Vary file sizes. Include some dead or awkward code a real project has.
- {{STACK}}
- Existing tests under the fixture must all pass on the fixture as it stands and finish in under 3 seconds in total.
- Nothing in the fixture may hint at the answer: no TODO or FIXME that names the work, no comment naming a defect, no test or doc that describes the finished behaviour, no leftover from a solution.
- Tests you put in the fixture must clean up any temp directory they create.
- Do not put a `.git` directory in the fixture.

## Task file

Also write `task-draft.json`, one JSON object with exactly these keys:
- `id`: `{{ID}}`
- `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 250 words. Say what is wanted, why, and what must not change. Give every name, path, export, format or visible label a test would rely on. Do NOT name any method, framework, tool or process for how to work. Do NOT list the causes, edge cases, traps or risks to look for: the agent has to find them in the repository. Do NOT tell the agent to ask or not to ask questions{{QUESTIONS_NOTE}}. Do not mention hidden checks, scoring or benchmarks.
- `limits`: `{ "softSec": 600, "hardSec": 1200 }`.
- `notes`: 3 to 6 short sentences for the key writer: the traps you built into the repository, what a careful answer must do that a quick one misses, and which files and exports the request names.

## Finish

Run the fixture's existing tests and make sure they pass. Do not write hidden tests, a solution or other answers. Write each file once, verify at most twice, and finish within about 45 tool calls. Keep everything plain, original and free of internal names, host paths, usernames or secrets. Stop when the files are written.
