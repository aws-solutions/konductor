You are writing ONE benchmark task for AI agents that do operations and reliability work. The agent under test receives a folder (an ops folder or a small service repository) and a request written the way a busy teammate would write it. Hidden checks, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh: invent the company, services, hosts, people and numbers. Copy nothing from any public postmortem, book or repository.

## The brief

{{BRIEF}}

## Fixture rules

Write `fixture/`, the folder the agent starts in. It must look like a real, lived-in team folder.
- {{SIZE}} files. Vary file sizes. Include a README, a docs or runbooks folder, and the noise a real folder has (old notes, an unrelated script, a stale doc).
- {{STACK}}
- Large data files (logs, metric CSVs, deploy history) are written by a generator you write first: `gen/generate.py`, Python 3.12 standard library only, a fixed random seed, writing into `fixture/`. Run it, then check the output by reading parts of it. Keep `gen/` outside `fixture/`. Logs are realistic: timestamps in UTC (ISO 8601), several services, request ids, health checks, routine warnings, retries, slow requests and other noise all day, not only during the problem. In all, the logs hold at least {{LOGLINES}} lines.
- Nothing in the fixture may hint at the answer: no generator metadata (seed, manifest), no file or deploy named after the fix, no note that names the cause, no comment naming a defect, no leftover from a solution, no file the reference solution creates.
- Do not put a `.git` directory in the fixture.

{{KIND}}

## Task file

Also write `task-draft.json`, one JSON object with exactly these keys:
- `id`: `{{ID}}`
- `prompt`: the request, in the voice of {{VOICE}}. Plain words, 80 to 260 words. Say what is wanted and why. Give every file path, field name and format the hidden checks rely on. Do NOT name any method, framework or process for how to work (no "five whys", "fishbone", "blameless", "write a plan first", "follow a checklist", "use the SRE book"). Do NOT list the causes, suspects, constraints or risks to look for: the agent has to find them in the folder. Do NOT tell the agent to ask or not to ask questions. Do not mention hidden checks, keys, scoring or benchmarks.
- `checks`: executable checks, each `{ "type", ..., "weight": number, "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd`, `min`; weight counts for the report only), `cmd` (shell command, optional `expectExit`), `file_exists` (`path`), `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex, case-insensitive), `min_matches` (`path`, `pattern`, `min`), `fixture_unchanged` (`path`). Only POSIX tools, `node` and `python3` may be used in `cmd`. Rules:
  - {{TESTSRULE}}
  - Add 2 to 4 other checks the hidden tests do not cover (a stated file exists; input files the agent must not edit are unchanged via `fixture_unchanged`). Mark a check `format` when it only checks layout or wording, or when an empty or shallow answer passes it (a stated file exists, an input file unchanged). Substance weights 1 to 3.
  - At most 25% of the substance weight of the non-`tests` checks may belong to checks that already pass on the untouched fixture.
  - Paths in checks are relative to the folder root the agent works in (no `fixture/` prefix).
  - No `contains` check may test for a loose keyword that a wrong answer would also contain, or for an exact phrase or line number that a correct answer could word differently.
  - Every check must pass on `fixture` plus `solution` plus `hidden`.
- `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }`, weights 1 to 3, only for what code cannot check. Each criterion ends with "(code cannot check this because ...)". Do not reward length or formatting.
- `limits`: `{ "softSec": number, "hardSec": number }`; hardSec is twice softSec.
- `notes`: 3 to 6 short sentences for the reviewer: the traps you built in, what a quick answer would get wrong, what the reference does.
{{EXTRAKEYS}}

## Finish

Run `node kit/selfcheck.js` (it builds `hidden/` from your draft and prints, per tests check, how many tests pass on fixture plus solution and on the plain fixture). Every test must pass on the reference; on the plain fixture at most 20% may pass. Fix what fails and run it again. Then print a short list of what you verified. Keep everything plain, original and free of internal names, real company names, host paths, usernames or secrets. Stop when the files are written and verified.
