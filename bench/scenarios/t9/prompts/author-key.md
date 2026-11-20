You are writing the scoring key of ONE benchmark task for AI coding agents. The current directory holds `fixture/` (the front-end repository the agent starts in) and `task-draft.json` (the request in `prompt`, plus `limits` and the first author's `notes`). Do not change `fixture/`, the `prompt` or the `limits`. Work only inside the current directory, except that `node kit/selfcheck.js` may use the browser installed on this machine. You have no network.

{{STACK}}

{{KIND}}

## Answers to write for the free scoring

Besides `solution/` (the reference), write two more overlays of the same shape (full files, only the files that change):
- `alt/`: a second CORRECT answer with a different structure and different names from the reference. It must pass every hidden test.
- `lazy/`: a plausible but shallow answer a hurried developer would write: it handles the obvious cases and misses the traps. It must pass at most 40% of the hidden tests.

## Add to task-draft.json

Add these keys to `task-draft.json` and keep the others as they are:
- `checks`: executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd`, `min`), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools and `node` may be used in `cmd`. Rules:
  - One `tests` check whose `cmd` is exactly the command in the kind section, with `min` as the kind section says.
  - Add 3 to 5 other checks the hidden tests do not cover. The code score is (0.5 x share of hidden tests passed + 0.2 x weight share of the other substance checks passed) / 0.7, and the plain fixture must score 20 or less and the `lazy/` answer 40 or less, so the other substance checks must FAIL on the plain fixture and on `lazy/`. Good ones: ONE `cmd` check that the visible suite passes AND at least N new test cases were added (N from 3 to 8); behaviour of the changed code run with a small `node -e` script. A `fixture_unchanged` check passes on the plain fixture: give it weight 1. Mark a check `format` when it only checks layout or wording. Substance weights from 1 to 3.
  - At most 20% of the substance weight (all checks except `tests`) may belong to checks that already pass on the untouched fixture.
  - Paths are relative to the repository root, with no `fixture/` prefix. Every check must pass on `fixture` plus `solution` plus `hidden`.
- `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check. Each criterion ends with "(code cannot check this because ...)" followed by three anchors: "Fail: ... Partial: ... Pass: ...".
- `notes`: replace with 3 to 6 short sentences for the reviewer: the traps the hidden tests check, what a lazy answer misses, what the reference does.
{{EXTRAKEYS}}

## Finish

Run `node kit/selfcheck.js` (it builds the scoring kit around your `hidden/`, then runs every `tests` check on fixture plus solution, the plain fixture, fixture plus `alt/` and fixture plus `lazy/`, and prints `estimatedScores`): the reference must reach 95 or more, `alt/` 80 or more, the plain fixture 20 or less and `lazy/` 40 or less. Fix what fails and run it again, at most three times. Write each file once where you can and finish within about 60 tool calls. Keep everything original, with no internal names, host paths or secrets. Stop when the files are written and verified.
