You are writing ONE benchmark task for AI coding agents. The agent under test receives a small, realistic front-end repository and a request written the way a busy teammate would write it. Hidden checks, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it, except that `node kit/selfcheck.js` may use the browser installed on this machine. You have no network. Write everything fresh: invent the product, names, copy and data. Copy nothing from any public repository.

## The brief

{{BRIEF}}

## Fixture rules

Write `fixture/`, the repository the agent starts in. It must look like a real, lived-in project.
- {{SIZE}} files. Source, existing tests that pass today, a CI config (`.github/workflows/ci.yml`), a README, a docs folder, a changelog, a package file, realistic data or config files. Vary file sizes. Include some dead or awkward code a real project has.
- {{STACK}}
- Existing tests under the fixture must all pass on the fixture as it stands (unless the kind section says otherwise) and finish in under 3 seconds in total.
- Nothing in the fixture may hint at the answer: no TODO or FIXME that names the work, no comment naming a defect, no leftover from a solution.
- Tests you put in the fixture must clean up any temp directory they create.
- Do not put a `.git` directory in the fixture.

{{KIND}}

## Answers to write for the free scoring

Besides `solution/` (the reference), write two more overlays of the same shape (full files, only the files that change):
- `alt/`: a second CORRECT answer with a different structure and different names from the reference (another way to split the code, other helper names, another algorithm where one exists). It must pass every hidden test.
- `lazy/`: a plausible but shallow answer a hurried developer would write: it handles the obvious cases, hits the words of the request, and misses the traps. It must pass at most 40% of the hidden tests.
Do not mention either in `task-draft.json` or in any fixture file.

## Task file

Also write `task-draft.json`, one JSON object with exactly these keys:
- `id`: `{{ID}}`
- `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 250 words. Say what is wanted, why, and what must not change. Give every name, path, format or element label that the hidden checks rely on. Do NOT name any method, framework, tool or process for how to work (no "TDD", "write a plan first", "use Playwright", "check accessibility with an audit", "follow a checklist"). Do NOT list the causes, edge cases, traps or risks to look for: the agent has to find them in the repository. Do NOT tell the agent to ask or not to ask questions{{QUESTIONS_NOTE}}. Do not mention hidden checks, scoring or benchmarks.
- `checks`: executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd`, `min`; weight counts for the report only), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools and `node` may be used in `cmd`. Rules:
  - One `tests` check whose `cmd` is exactly the command in the kind section, with `min` as the kind section says.
  - Add 3 to 5 other checks the hidden tests do not cover. The code score is (0.5 x share of hidden tests passed + 0.2 x weight share of the other substance checks passed) / 0.7, and the plain fixture must score 20 or less and the `lazy/` answer 40 or less. So the other substance checks must FAIL on the plain fixture and on `lazy/`. Good ones: ONE `cmd` check that the visible suite passes AND the agent added at least N new test cases (count `test(` or `it(` lines in `test/` against the fixture's count, N from 3 to 8); a file the request asks for exists AND its content parses or holds a stated field (one `cmd` with `node -e`); behaviour of the changed code run with a small `node -e` script. A `fixture_unchanged` check on a file the request says must not change passes on the plain fixture, so give it weight 1 and make the other substance weights add up to at least 5. Mark a check `format` when it only checks layout or wording (format checks do not score). Substance weights from 1 to 3.
  - At most 20% of the substance weight (all checks except `tests`) may belong to checks that already pass on the untouched fixture.
  - Paths in checks are relative to the repository root, with no `fixture/` prefix.
  - Every check must pass on `fixture` plus `solution` plus `hidden`.
- `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check. Each criterion ends with "(code cannot check this because ...)". Do not reward length or formatting.
- `limits`: `{ "softSec": number, "hardSec": number }`; hardSec is twice softSec.
- `notes`: 3 to 6 short sentences for the reviewer: the traps you built in, what a lazy answer would miss, what the reference does.
{{EXTRAKEYS}}

## Finish

Run `node kit/selfcheck.js` (it builds the scoring kit around your `hidden/`, then runs every `tests` check on fixture plus solution, on the plain fixture, and on fixture plus `alt/` and `lazy/`; it prints passed/total for each). It also prints `estimatedScores`, the code score the free dry run will give each answer: the reference must reach 95 or more, `alt/` 80 or more, the plain fixture 20 or less and `lazy/` 40 or less. Fix what fails and run it again. Then print a short list of what you verified. Keep everything plain, original and free of internal names, host paths, usernames or secrets. Stop when the files are written and verified.
