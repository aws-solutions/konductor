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
2. `hidden/`: hidden tests, laid out relative to the repository root (they are copied over it before they run). {{HIDDEN}}
   - At least 12 tests. Each test is independent, deterministic and finishes in under 5 seconds. No real clock sleeps, no network, no randomness without a fixed seed. Tests that make temp directories remove them.
   - Test only behaviour and interfaces that the request states (names, file paths, flags, output formats, limits). If a test needs a name the request does not give, the task is unfair; add the name to the request instead.
   - On the untouched fixture at most 20% of the hidden tests may pass. These are mostly new-behaviour tests.
   - Some tests must catch a plausible wrong or lazy answer (a special-cased value, a skipped edge case, a regression in existing behaviour). Do not make every test depend on one detail, so one slip fails only a few tests.
3. `solution/`: the reference solution as an overlay. Include every file the reference adds or changes, at its path in the repository, in full (a file in `solution/` replaces the same path in `fixture/`; to delete a fixture file list its path in `solution/DELETE.txt`, one path per line). It must be an honest, realistic change, not minimal tricks. It must make every hidden test pass and keep every existing fixture test passing (except tests the request tells the agent to change).
4. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, in the voice of a teammate who owns the repo. Plain words, 80 to 250 words. Say what is wanted and what must not change. Give every interface the hidden tests rely on. Do NOT name any method, framework or process for how to work (no "write a plan", "use TDD", "do a threat model", "follow a checklist"). Do NOT tell the agent to ask or not to ask questions. Do not mention hidden tests, scoring or benchmarks.
   - `checks`: a list of executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd` runs the hidden tests, `min` is the number of hidden tests, `weight` counts for the report only), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools and `node` or `python3` (3.12) may be used in `cmd`. Rules for the set:
     - One `tests` check whose `cmd` is exactly: {{TESTCMD}}
     - Add 4 to 8 other checks that look at the result in a way the hidden tests cannot: the visible test suite still passes, the agent added tests of its own (count test cases in new files), no new dependency was added, the docs or changelog mention the change, a stated file or setting exists. Mark a check `format` when it only checks layout or wording. Give the substance checks weights from 1 to 3.
     - At most 25% of the total substance weight (counting every non-`tests` check) may belong to checks that already pass on the untouched fixture.
     - Every check must pass on `fixture` plus `solution`.
   - `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check (for example whether the final message states honestly what was and was not verified). Each criterion ends with a clause "(code cannot check this because ...)". Do not reward length or formatting.
   - `limits`: `{ "softSec": number, "hardSec": number }`. Estimate the time a competent agent needs; hardSec is twice softSec.
   - `notes`: 3 to 6 short sentences for the reviewer: the traps you built in, what a lazy answer would miss, and what the reference changes.
5. Run your own checks before you finish: put `fixture/` plus `solution/` in a scratch folder, run the existing tests and the hidden tests, and run the hidden tests against the plain `fixture/` to confirm at most 20% pass. Fix what fails. Then print a short list of what you verified.

Keep everything plain, original and free of any internal names, host paths, usernames or secrets. Stop when the files are written and verified.
