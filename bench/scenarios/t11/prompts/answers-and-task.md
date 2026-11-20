## Answers to write for the free scoring

Besides `solution/` (the reference), write two more answers of the same shape (only the files that change, in full, or an `APPLY.sh`):
- `alt/`: a second CORRECT answer with a different structure and wording from the reference (other names, another order, another way to split the code or the document). It must pass every hidden test.
- `lazy/`: a plausible but shallow answer a hurried person would write: it handles the obvious part, uses the words of the request, and misses the traps. It must pass at most 40% of the hidden tests.
Do not mention either in `task-draft.json` or in any fixture file.

## Task file

Write `task-draft.json`, one JSON object with exactly these keys:
- `id`: `{{ID}}`
- `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 250 words. Say what is wanted, why, and what must not change. Give every name, path, format or field that the hidden checks rely on. Do NOT name any method, tool, framework or process for how to work. Do NOT list the traps, edge cases or risks to look for: the agent has to find them. Do NOT tell the agent to ask or not to ask questions. Do not mention hidden checks, scoring or benchmarks.
- `checks`: executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd`, `min`), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern`, a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools, `git` and `node` may be used in `cmd`. Rules:
  - One `tests` check exactly as the kind section gives it.
  - Add 2 to 4 other checks the hidden tests do not cover. The code score is (0.5 x share of hidden tests passed + 0.2 x weight share of the other substance checks passed) / 0.7. The plain fixture must score 20 or less and `lazy/` 40 or less, so the other substance checks must fail on the plain fixture. A `fixture_unchanged` check passes on the plain fixture: give it weight 1 and make the other substance weights add up to at least 5. Mark a check `format` when it only checks layout or wording (format checks do not score).
  - Paths in checks are relative to the repository root, with no `fixture/` prefix.
  - No `contains` check may test a loose keyword a wrong answer also has, or an exact phrase a correct answer could word differently.
  - Every check must pass on the reference.
- `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check. Each criterion ends with "(code cannot check this because ...)". Do not reward length or formatting.
- `limits`: `{ "softSec": number, "hardSec": number }`; hardSec is twice softSec.
- `notes`: 3 to 6 short sentences for the reviewer: the traps you built in, what a lazy answer would miss, what the reference does.
{{EXTRAKEYS}}

## Finish

Run `node kit/selfcheck.js`. It scores, with the bench's own check code, the plain fixture, fixture plus `solution/`, `alt/` and `lazy/`, and prints `estimatedScores` and the checks each one fails. The reference must reach 95 or more, `alt/` 80 or more, the plain fixture 20 or less and `lazy/` 40 or less, and `deterministic` must be true. Fix what fails and run it again. Then print a short list of what you verified. Keep everything plain, original and free of internal names, real company names, host paths, usernames or secrets. Stop when the files are written and verified.
