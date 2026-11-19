You are writing ONE benchmark task for AI coding agents. The agent under test will receive a small realistic repository and a request written the way a busy teammate would write it. Hidden checks, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh; copy nothing from any public repository.

## The brief

{{BRIEF}}

## Fixture rules

Write `fixture/`, the repository the agent starts in. It must look like a real, lived-in project.
- {{SIZE}} files, excluding any dependency directory. Source, existing tests that pass today, a CI config (`.github/workflows/ci.yml`), a README, a docs folder, a changelog, a package or project file, realistic data or config files. Vary file sizes. Include some dead or awkward code a real project has.
- {{STACK}}
- Existing tests under the fixture must all pass on the fixture as it stands, and finish in under 3 seconds in total.
- Nothing in the fixture may hint at the answer: no TODO or FIXME that names the work, no comment naming a defect, no leftover from a solution.
- Tests you put in the fixture must clean up any temp directory they create.
- Do not put a `.git` directory in the fixture.

{{KIND}}

## Task file

Also write `task-draft.json`, one JSON object with exactly these keys:
- `id`: `{{ID}}`
- `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 250 words. Say what is wanted and what must not change. Give every name, path or format that the hidden checks rely on. Do NOT name any method, framework or process for how to work (no "mutation testing", "write a plan first", "use TDD", "do a threat model", "follow a checklist", "equivalence classes"). Do NOT tell the agent to ask or not to ask questions{{QUESTIONS_NOTE}}. Do not mention hidden checks, mutants, scoring or benchmarks.
- `checks`: executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd`, `min`; weight counts for the report only), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools and `node` or `python3` (3.12) may be used in `cmd`. Rules:
  - One `tests` check whose `cmd` is exactly {{TESTCMD}} and whose `min` is {{TESTMIN}}.
  - Add 3 to 6 other checks that look at the result in a way the hidden tests cannot (the visible suite still passes with the agent's changes; the agent added test cases of its own in new or changed test files, counted; the source files it was not asked to change are unchanged via `fixture_unchanged`; a stated file exists). Mark a check `format` when it only checks layout or wording. Substance weights from 1 to 3.
  - At most 25% of the substance weight (all checks except `tests`) may belong to checks that already pass on the untouched fixture.
  - Every check must pass on `fixture` plus `solution` and `hidden`.
- `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check. Each criterion ends with "(code cannot check this because ...)". Do not reward length or formatting.
- `limits`: `{ "softSec": number, "hardSec": number }`; hardSec is twice softSec.
- `notes`: 3 to 6 short sentences for the reviewer: the traps you built in, what a lazy answer would miss, what the reference does.

## Finish

Run your own checks before you finish, as described in the kind section. Fix what fails. Then print a short list of what you verified. Keep everything plain, original and free of internal names, host paths, usernames or secrets. Stop when the files are written and verified.
