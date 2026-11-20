You are writing ONE benchmark task for AI coding agents. The agent under test will receive a small realistic repository and a request written the way a busy teammate would write it. Hidden tests, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh; copy nothing from any public repository.

## The brief

{{BRIEF}}

## What to produce

Write these into the current directory:

1. `fixture/`: the repository the agent starts in. It must look like a real, lived-in project.
   - {{SIZE}} files, excluding any dependency directory. Source, existing tests that pass today, a CI config (`.github/workflows/ci.yml`), a README, a docs folder, a changelog, a package or project file, realistic data or config files. Vary file sizes. Include some dead or awkward code a real project has.
   - {{STACK}}
   - Existing tests under the fixture must all pass on the fixture as it stands.
   - Nothing in the fixture may hint at the answer: no TODO or FIXME that names the work, no comment naming a defect, no test or doc that describes the finished behaviour, no leftover from a solution.
   - Tests you put in the fixture must clean up any temp directory they create.
2. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, in the voice of a teammate who owns the repo. Plain words, 80 to 250 words. Say what is wanted and what must not change. Give every interface a test would rely on (names, file paths, flags, output formats, limits). Do NOT name any method, framework or process for how to work. Do NOT tell the agent to ask or not to ask questions. Do not mention tests you have not written, scoring or benchmarks.
   - `limits`: `{ "softSec": 600, "hardSec": 1200 }`.
   - `notes`: 3 to 6 short sentences: the traps you built in and what a careful answer must do that a quick one misses.
3. Run the fixture's existing tests and make sure they pass. Do not write hidden tests or a solution: a separate step writes those from your files.

Write each file once, verify at most twice, and finish within about 45 tool calls. Keep everything plain, original and free of any internal names, host paths, usernames or secrets. Stop when the files are written.
