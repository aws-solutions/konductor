<!-- SPDX-License-Identifier: Apache-2.0 -->

# Skill benchmark

The skill benchmark measures whether a skill in `skills/` makes an agent's answers better. For each skill it takes a fixed set of tasks (realistic requests) and has an agent answer each one twice: once with the skill and once without it. Judge models then score each answer on its own, without being told which one it is. The gap between the two scores says whether the skill helped, changed nothing, or made answers worse.

This guide covers what exists today: the vocabulary, the formats of the frozen baseline files (written by a model, checked before use) and the exclusions file, where files live, and the offline `plan` command that checks the files and estimates the cost. Running the tasks and judging the answers are added in a later PR.

## How a run works

1. A **baseline** for the skill is written once and committed: the skill's rules, a set of tasks, and a checklist for each task. A run never changes it.
2. The agent answers every task twice, once per **arm** (with the skill, without it).
3. Judges score each answer on its own against a checklist. A judge sees one answer and is not told which arm it came from.
4. A report compares the two arms.

`plan` shows what steps 2 to 4 would do and cost, for the skills you pick. It makes no network or model call and writes no file.

## Glossary

| Term      | Meaning                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arm       | One way of answering a task. `with` has the skill installed; `without` does not.                                                                                                                    |
| Baseline  | The frozen files for one skill: rules, tasks and bucket sidecars, committed under `bench/baselines/<skill>/`. Stale when `SKILL.md` or the rules change.                                            |
| Rule      | One instruction from `SKILL.md`, with a quote that must appear in the file and a class.                                                                                                             |
| Class     | `useful` changes what an answer says. `style` is a format or wording rule. `generic` is good practice for any answer.                                                                               |
| Task      | A realistic request, written so that at least two rules matter without being named. Each task has a checklist, its `rubric`.                                                                        |
| Batch     | A named set of tasks for one skill, such as `b1`, with one task file. A second batch of fresh tasks checks that a result holds beyond the first set.                                                |
| Reading B | The rules reading: judges score each answer on its own against the task's rules checklist. Its scale is `items`.                                                                                    |
| Reading A | The request-only reading: the same answers scored against a checklist written from the request alone. Its scale is `outcome`. The checklist writer is added in a later PR; `plan` counts its calls. |
| Seat      | One judge: a name (`anthropic`, `openai`, `xai` by default) and a model. The seats use models from different families.                                                                              |
| Bucket    | Where a checklist item counts, set by its rule's class: `value` (`useful`), `format` (`style`) or `guard` (`generic`).                                                                              |
| Guard     | The `guard` bucket: items from generic rules. They show whether the skill leaves ordinary quality alone. Its report is added in a later PR.                                                         |
| Exclusion | A task left out of reading A only, with a reason and a date, when the checklist writer cannot make a usable checklist for it. Never allowed for reading B.                                          |
| Ledger    | The append-only file `bench/out/ledger.jsonl` of every paid call of all runs: its upper estimate, then the cost its CLI reports or, with none, its mean. See Spend limits and the ledger.           |
| Run id    | The name of one run's folder under `bench/out/`. Default: `default`.                                                                                                                                |
| Stage     | A step of a run as `plan` lists it: 1 prep, 2 rules reading, 3 request-only reading, 4 report.                                                                                                      |

## Where files live

```
skills/<skill>/SKILL.md                      the skill under test (read only)
agents/*.agent-spec.json                     agents; one that lists the skill answers for it (read only)
scripts/bench/prompts/                       judge prompt templates (byte-exact, see Judge prompts)
bench/config.json                            the settings (git-ignored), see Settings
bench/exclusions.json                        tasks left out of reading A
bench/baselines/<skill>/rules.json           frozen rules
bench/baselines/<skill>/tasks-<batch>.json   frozen tasks, one file per batch
bench/baselines/<skill>/tasks-<batch>.buckets.json
bench/out/<run-id>/                          run data (git-ignored)
  answers/<skill>/<batch>/<task>.<with|without>.json
  raw/<skill>/<batch>/<task>.<with|without>/raw.jsonl   subject event log, and its kept earlier tries
  checklists/<skill>/<batch>/<task>.json
  judgments/<items|outcome>/<skill>/<batch>/<task>.<seat>.<with|without>.json
  report.json, report.md
```

Everything under `bench/out/` is git-ignored. Baselines are committed. A small valid example of every file lives in `tests/fixtures/bench/repo/`.

Names that become file names (skill, batch, task id, seat, run id) are checked so none can point outside its folder. A skill name is lowercase letters, digits and `-`, up to 128 characters, and a batch name is the same. A task id or run id starts with a letter or digit, then letters, digits, `.`, `_` and `-`, up to 128 characters, with no `..`. The run ids `ledger.jsonl` and `ledger.jsonl.lock` are not allowed, in any letter case, because `bench/out/ledger.jsonl` is the spend ledger and `bench/out/ledger.jsonl.lock` is its lock file. Two task ids in one task file (or in one batch of the exclusions file) that differ only in case, such as `T1` and `t1`, are refused with both ids named, because macOS and Windows file systems would give them one file. A seat name is lowercase letters, digits, `_` and `-`, starting with a letter or digit, up to 64 characters. It has no `.`: a judgment file is named `<task>.<seat>.<arm>.json`, and with no `.` in the seat, two different pairs of task and seat can never share a file. It has no capitals, because macOS and Windows file systems ignore case and seats `A` and `a` would overwrite each other's file. A seat name in `models.judges` that breaks these rules is refused with the setting named.

All four baseline and exclusion files are JSON with `"format_version": 1`. Rules, tasks and buckets are written by a model and then frozen; `bench/exclusions.json` is written by a person. A reader refuses an unknown version, a missing field, a field of the wrong type and an extra field, so a typo cannot pass quietly. `plan` names the file and the field for every problem it finds.

Files are read as UTF-8. A leading byte order mark, which some Windows editors add, is ignored. A key that appears twice in one object is an error that names the key, where it is and the line, because a JSON reader keeps only the last one and the earlier record would be dropped without a word. This applies to every JSON file `plan` reads, including `bench/config.json`.

## File formats

### Rules file: `bench/baselines/<skill>/rules.json`

The rules of the skill that the benchmark checks.

```json
{
  "format_version": 1,
  "skill": "brew-log",
  "skill_md_sha256": "<64 hex characters>",
  "request_context": "A request to write a short log entry for a tea or coffee brew.",
  "rules": [
    {
      "id": "brew-log-r01",
      "source_quote": "Open with the water temperature and the steep time.",
      "class": "useful",
      "outcome": "The entry begins with the water temperature and the steep time.",
      "why": "A later reader needs both to repeat the brew.",
      "scenario_hint": "A brew where the requester wrote down both."
    }
  ]
}
```

| Field             | Rule                                                                               | Why                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `skill`           | The skill's folder name.                                                           | Catches a rules file moved to the wrong folder.                                                   |
| `skill_md_sha256` | SHA-256 of the bytes of `SKILL.md`, 64 lowercase hex characters (`shasum -a 256`). | If `SKILL.md` changes, the rules may be out of date, so `plan` marks the baseline `rules stale`.  |
| `request_context` | One sentence of text.                                                              | Tells whoever writes tasks what kind of request the skill answers.                                |
| `rules`           | At least 3.                                                                        | With fewer, one rule decides the whole result.                                                    |
| `rules[].id`      | `<skill>-rNN` with two or more digits, unique in the file.                         | Checklist items and bucket entries point at rules by id.                                          |
| `source_quote`    | A phrase that appears in `SKILL.md`, ignoring case and spacing.                    | Ties the rule to the skill's own words. Checked while the hash above still matches.               |
| `class`           | `useful`, `style` or `generic`.                                                    | Sets the bucket. `plan` warns when no rule is `generic`, because the guard bucket would be empty. |
| `outcome`         | What a good answer shows, as a checkable statement.                                | The basis of the checklist item.                                                                  |
| `why`             | Text, may be blank.                                                                | For the person who reviews the baseline. No check or score reads it.                              |
| `scenario_hint`   | Text: a situation where the rule matters.                                          | Helps whoever writes tasks make the rule matter.                                                  |

### Task file: `bench/baselines/<skill>/tasks-<batch>.json`

The tasks of one batch, each with its checklist. The file name must say the batch: `tasks-b1.json` holds `"batch": "b1"`.

```json
{
  "format_version": 1,
  "skill": "brew-log",
  "batch": "b1",
  "generated_at": "2026-01-15T10:00:00Z",
  "model": "human",
  "skills_version": "fixture-1",
  "rules_sha256": "<64 hex characters>",
  "scenarios": [
    {
      "id": "brew-log-rules-1",
      "title": "Morning sencha that came out sharp",
      "target_section": "Rules",
      "prompt": "<a request of 45 words or more>",
      "rubric": [
        "The entry opens with the 80 C water temperature and the two minute steep.",
        "...four to seven more items..."
      ]
    }
  ]
}
```

This example is cut short. A valid file has at least 5 tasks, each with 5 to 8 rubric items.

| Field                     | Rule                                                                                                                           | Why                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `skill`, `batch`          | Must match the folder and the file name.                                                                                       | Catches a file copied to the wrong place.                                                           |
| `generated_at`            | A real UTC time such as `2026-01-15T10:00:00Z`: hour 0 to 23, minute and second 0 to 59, and an optional fraction of a second. | Records when the tasks were written.                                                                |
| `model`                   | Text: who wrote the tasks (`human` or a model id).                                                                             | Records where the tasks came from.                                                                  |
| `skills_version`          | Any non-blank text.                                                                                                            | A label for the version of the skills the tasks were written against.                               |
| `rules_sha256`            | SHA-256 of the bytes of `rules.json`.                                                                                          | If the rules change, `plan` marks the batch `tasks stale`.                                          |
| `scenarios`               | At least 5, with ids unique in the file.                                                                                       | With fewer, one odd task can decide the result.                                                     |
| `id`                      | A valid name (see above).                                                                                                      | Becomes part of the file names of answers, checklists and judgments.                                |
| `title`, `target_section` | Text. `target_section` is the part of the skill the task exercises.                                                            | For the person who reviews the baseline.                                                            |
| `prompt`                  | At least 45 words. It must not name the skill, contain a rule id, or contain a rule's `source_quote`.                          | A request needs enough facts for rules to matter. A prompt that names a rule hands the answer away. |
| `rubric`                  | 5 to 8 items.                                                                                                                  | Fewer than 5 makes each item weigh too much. More than 8 is hard for a judge to apply evenly.       |
| each rubric item          | 12 to 400 characters, one item per rule outcome, checkable in any output format.                                               | Under 12 is a label, not a checkable statement. Over 400 is usually several statements in one.      |
| `why_skill_matters`       | Optional text.                                                                                                                 | A note for the reviewer, never shown to the agent or a judge.                                       |

A prompt "names the skill" when the skill's name appears as a whole word. A hyphenated name such as `brew-log` is caught anywhere. A single-word name such as `verification` is caught when it is in quotes or next to the word "skill", because it is also an ordinary word.

### Bucket sidecar: `bench/baselines/<skill>/tasks-<batch>.buckets.json`

Says which rule each checklist item came from and which bucket it counts in. Item `n` of a task's `rubric` is item `"n"` here.

```json
{
  "format_version": 1,
  "skill": "brew-log",
  "batch": "b1",
  "rules": {
    "brew-log-r01": { "class": "useful", "kept": true, "bucket": "value" },
    "brew-log-r06": { "class": "style", "kept": false, "bucket": "format" }
  },
  "scenarios": {
    "brew-log-rules-1": {
      "1": { "bucket": "value", "rule_id": "brew-log-r01" }
    }
  }
}
```

| Field                  | Rule                                                                              | Why                                                 |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| `rules`                | Lists exactly the rules of `rules.json`, each with the same `class`.              | The sidecar cannot drift from the rules.            |
| `rules.<id>.bucket`    | `useful` goes with `value`, `style` with `format`, `generic` with `guard`.        | One class, one bucket.                              |
| `rules.<id>.kept`      | `false` when the owner dropped the rule from checking.                            | A dropped rule must have no item in any task.       |
| `scenarios`            | One entry for every task in the task file, and none for a task that is not there. | Every item can be traced.                           |
| `scenarios.<task>.<n>` | Items numbered 1 to n with no gap; n equals the length of the task's `rubric`.    | Item `n` here is item `n` of the checklist.         |
| `bucket`, `rule_id`    | `rule_id` names a kept rule, and `bucket` equals that rule's bucket.              | An item counts in the bucket of the rule it checks. |

### Exclusions file: `bench/exclusions.json`

Optional. Lists tasks left out of reading A.

```json
{
  "format_version": 1,
  "batches": {
    "b1": {
      "scenarios": [
        {
          "id": "brew-log-rules-3",
          "scales": ["outcome"],
          "reason": "the checklist writer was blocked on this request twice",
          "date": "2026-01-16"
        }
      ]
    }
  }
}
```

| Field     | Rule                                                   | Why                                                                                         |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `batches` | Keys are batch names. A task is listed once per batch. | Batch names are shared by every skill, so an id is looked up across skills.                 |
| `id`      | A task id.                                             | `plan` warns when it matches no task of any skill with a baseline, which is usually a typo. |
| `scales`  | Exactly `["outcome"]`. `items` is refused.             | A task may leave reading A, never reading B.                                                |
| `reason`  | At least 20 characters.                                | Lets a reader see later why the task was left out.                                          |
| `date`    | A real date written `YYYY-MM-DD`.                      | Records when the decision was made.                                                         |

## Running `plan`

```
node scripts/bench/bench.js plan --skills brew-log,pantry-note --root tests/fixtures/bench/repo
```

With no `--skills`, `plan` prints its usage and the skills that have a baseline, and plans nothing.

| Option            | Meaning                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--skills <a,b>`  | Skills to plan. Each must have `skills/<name>/SKILL.md`.                                                                                                           |
| `--run <id>`      | Run folder under `bench/out/` (default `default`). A call counts as done if its file exists.                                                                       |
| `--max-usd <n>`   | Spend limit for this run in USD (default 30), a plain decimal such as `2.5`. Hex, exponents, signs and spaces are refused. It cannot be set above `total_cap_usd`. |
| `--config <file>` | Settings file to use instead of `bench/config.json`.                                                                                                               |
| `--root <dir>`    | Repository root to read (default: this checkout).                                                                                                                  |
| `--json`          | Print the plan as JSON. A flag that takes no value refuses one: `--json=false` exits 64.                                                                           |

`--all` and `--changed-since` are not available yet and exit 64.

### JSON output

With `--json` the plan is one JSON object. `pending_usd` is the estimated cost (the mean) of the pending calls rounded to cents, and `pending_usd_unrounded` the same sum before rounding. `pending_usd_p90` is the upper estimate (the p90) rounded to cents, and `pending_usd_p90_unrounded` the same sum before rounding, which is what is compared with the limits. `worst_case_usd` is the upper estimate too, rounded to cents. Each stage has `usd` (mean) and `usd_p90`. `within_max` says whether the plan is within `max_usd`, counting what this run has already spent or reserved (`run_usd`). `within_total_cap` says whether it keeps the ledger within `total_cap_usd` (`null` when the ledger cannot be read). `ledger` holds what the spend ledger holds: `total_usd` spent, `reserved_usd` in live reservations, `calls` settled, `unstarted_calls` (charged 0), `expired` (`count` and `usd` of reservations past their expiry, counted as spent) and `projected_usd` (the total with this plan). `ok` is `true` when nothing refused the plan, which is exit code 0, and is the field a script should read.

### Statuses

| Status               | Meaning                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`              | Valid baseline, up to date. Planned in full.                                                                                                                                                        |
| `rules stale`        | `SKILL.md` changed since `rules.json` was written. Reading A is planned; reading B waits for a refreshed baseline.                                                                                  |
| `tasks stale`        | `rules.json` changed since a task file was written. Reading A is planned; reading B is left out for that batch.                                                                                     |
| `invalid baseline`   | A file breaks its format or contradicts another, or `rules.json` has no `tasks-<batch>.json` file next to it. Every problem is listed, also when no agent lists the skill, and the plan is refused. |
| `invalid agent spec` | An agent spec that may list the skill has bad JSON, a repeated key or a wrong `skillNames`. The file is named and the plan is refused.                                                              |
| `no baseline`        | The skill has no baseline folder. Nothing to plan.                                                                                                                                                  |
| `no agent`           | No agent lists the skill. Nothing to plan.                                                                                                                                                          |

The agent for a skill is the agent whose `agents/<name>.agent-spec.json` lists the skill under `dependencies.skills.skillNames`. If several list it, `k-developer` is used when it is one of them, otherwise the first by name. Every spec in `agents/` is read, in name order, with the same reader as the baseline files: a byte order mark is fine and a repeated key is refused. A spec that cannot be used is never skipped, because the plan would then name another agent or say `no agent`; it is the problem `invalid agent spec`.

### Exit codes

| Code | Meaning                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done.                                                                                                                                                                                         |
| 1    | The plan is refused: an invalid baseline or agent spec, a projected cost above `max_usd`, a plan that would take the spend ledger past `total_cap_usd`, or no selected skill that can be run. |
| 64   | Usage error: a bad flag or value, an unknown skill, or a settings file that cannot be read. For `cost-profile`, also a ledger with a corrupt line.                                            |
| 66   | A file or folder the plan needs is missing.                                                                                                                                                   |
| 70   | Internal error: a bug in the benchmark. One line says so. `BENCH_DEBUG=1` adds the stack trace.                                                                                               |
| 74   | I/O error reading a file or folder, such as permission denied. This includes a baseline, exclusions or agent spec file that cannot be read.                                                   |

Every failure except 70 prints an `error: <what> (<file>)` line to stderr and no stack trace. Bad JSON or a repeated key in a baseline or in `bench/exclusions.json` is not a crash: the file is listed as a problem and `plan` exits 1. Bad JSON or a repeated key in a settings file exits 64. A file that cannot be read at all (permission denied, a symlink loop, a folder in place of a file) is not bad JSON: it exits 74 for a baseline, exclusions, agent spec or `SKILL.md` file, and a file that vanishes while it is read exits 66. A baseline file that is not there is not an I/O error: it is listed as `file is missing` and the plan exits 1. The settings file is the exception: any problem reading it, including one of these, exits 64. A plan whose selected skills are all `no baseline` or `no agent` has nothing to run: `plan` exits 1 and prints one line under `Refused` that names each skill and its status. A selection that also holds a skill that can be run is not refused for that reason. `node scripts/bench/bench.js --help` lists the same codes.

## Settings and cost

Every command reads its settings from `bench/config.json`, which is git-ignored. To start one, run `cp bench/config.example.json bench/config.json` and then edit it. Without it, a command stops with a line that names the full path of the settings file it looked for and the `cp` command that makes it there. The committed `bench/config.example.json` holds every setting at its default, and the settings file must hold every setting too: a missing one is refused by name (`<setting>: missing; copy it from bench/config.example.json`), and so is a setting the example does not have. `--config <file>` reads another file instead, with the same rules. The limits must satisfy `max_usd <= total_cap_usd`. The old `stop_usd` and `hard_cap_usd` are refused with a message that names `total_cap_usd`, so a stale settings file cannot pass. The old `orders_per_pair` is refused too (`removed: each answer is scored on its own`), and so are the old `agent_for` (`removed: the agent comes from the agent specs`) and `needs_tools` (`removed: not in the MVP`).

| Setting                           | Default                                                                                                    | What it does                                                                                                                                                                                                                                                                              | When to change it                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `models.subject`                  | `claude-sonnet-5-5`                                                                                        | The model that answers the tasks, with and without the skill.                                                                                                                                                                                                                             | To measure the skills on another model. Work made with the old model is stale.                             |
| `models.judges`                   | `anthropic`: `us.anthropic.claude-opus-5-5`, `openai`: `us.openai.gpt-6.1-terra`, `xai`: `us.xai.grok-4.7` | The judge seats, seat name to model. A seat name is lowercase letters, digits, `_` and `-`.                                                                                                                                                                                               | To add, drop or repin a judge. Work made with the old model is stale.                                      |
| `models.rubric_writer`            | `null`                                                                                                     | The model that writes the request-only checklists. `null` means the `anthropic` seat's model.                                                                                                                                                                                             | To write the checklists with a model that is not a judge. Without an `anthropic` seat it must be set.      |
| `max_usd`                         | `30`                                                                                                       | Spend limit of one run in USD. `--max-usd` overrides it for one command.                                                                                                                                                                                                                  | To allow a bigger or smaller run. It cannot pass `total_cap_usd`.                                          |
| `total_cap_usd`                   | `100`                                                                                                      | Spend limit of the ledger total across every run, in USD.                                                                                                                                                                                                                                 | When the whole budget changes.                                                                             |
| `confirm_above_usd`               | `5`                                                                                                        | A paid run whose estimate is at or above this many USD asks for confirmation first. `0` always asks.                                                                                                                                                                                      | To be asked more or less often.                                                                            |
| `estimate_usd_per_call`           | `subject` 0.078125, `judge` 0.0625, `writer` 0.01375                                                       | The fallback price, in USD per call, of a model the cost profile has no entry for: its mean, with a p90 of 1.5 times it. The writer figure is per request-only checklist. `plan` warns when it uses one.                                                                                  | When you add a model with no history. Lower figures let through a run that should be refused, so err high. |
| `aws_profile`                     | `null`                                                                                                     | The AWS profile subject runs export credentials from. `null` uses `AWS_PROFILE` from the environment; with neither, a subject run stops.                                                                                                                                                  | When your Bedrock access is under a named profile.                                                         |
| `aws_region`                      | `us-west-2`                                                                                                | The AWS region of every model call.                                                                                                                                                                                                                                                       | When your models are in another region.                                                                    |
| `judge_timeout_ms`                | `240000`                                                                                                   | How long one judge call may run, in ms, before it is killed and counted as failed.                                                                                                                                                                                                        | When a judge model is slower or faster than the pinned ones.                                               |
| `judge_timeout_ms_by_seat`        | `{"xai": 720000}`                                                                                          | A longer limit for a slow seat, seat name to ms. Grok's valid judgments took up to 223 s (median about 120 s), and several hit 240 s on every try.                                                                                                                                        | When a seat times out often, or a seat is added or dropped.                                                |
| `judge_max_output_tokens`         | `9000`                                                                                                     | The most tokens one judge or checklist-writer reply may have, from 256 to 128000. It is the output limit in the model's entry of the call's OpenCode config, and it sets what the call reserves (see Judge calls). A seat in `judge_max_output_tokens_by_seat` has its own limit instead. | To tighten or raise the limit of every seat, e.g. when a job result counts replies cut off at the limit.   |
| `judge_max_output_tokens_by_seat` | `{"openai": 5000, "xai": 37500}`                                                                           | A limit for one seat, seat name to tokens (256 to 128000). Grok writes the longest replies (p99.9 12490 tokens); Terra the shortest (1657). A seat with no entry gets `judge_max_output_tokens`. An entry for a seat that is not in `models.judges` is refused.                           | When a seat is cut off often, or never needs much, or a seat is added or dropped.                          |
| `runner_profile`                  | `legacy`                                                                                                   | How the `with` arm loads the skill and which tools both arms get (see Runner profile and isolation). `legacy`: an explicit load instruction. `natural`: no instruction, so pickup counts in the gap.                                                                                      | To measure whether agents pick the skill up on their own. Answers made under the other profile are stale.  |
| `subject_concurrency`             | `6`                                                                                                        | Subject runs that may run at once in one pairs job, 1 to 32. The first run of a job always goes alone, as a check that the pinned model answers.                                                                                                                                          | Lower it when the provider throttles; raise it for a faster job.                                           |

The model IDs are pinned in the example. They were not re-checked against Bedrock when it was written. A change to one is a settings change in its own commit, and work made with the old ID is stale.

### Cost profile

`plan`, the jobs and the ledger price each call from the cost profile `bench/profiles/cost-observed.json`: for each call kind (`subject`, `judge`, `writer`) and model, the `mean`, `median` and `p90` (90th percentile) cost of one call in earlier runs, with the number of `calls` and `failed` calls it was measured on. Its `provenance` says where the figures come from. The lookup for a call is the entry for its exact kind and model, then the kind's entry with model `"*"`, then `estimate_usd_per_call` for the kind as the mean, with 1.5 times that as the p90. A subject run is priced by `models.subject`, each judge seat by its own model, and a checklist call by the writer model (`models.rubric_writer`, else the `anthropic` seat's model). `plan` prints one warning that names every pending call kind and model priced at `estimate_usd_per_call`. A profile that breaks its rules (schema version 1, `unit` `"usd"`, a known kind, a model, finite amounts of 0 or more, `p90` at least the mean, no unknown entry field, no `cliReportsLow` on a `"*"` entry) stops every command but `cost-profile` with a usage error that names the file; there is no silent fallback.

The mean is the estimated cost; the p90 is the upper estimate. `plan` checks the p90 total against `max_usd` and `total_cap_usd`, and the ledger reserves each call at its p90 (a subject run at the larger of its p90 and its budget cap, see Subject runs; a judge or checklist call at its ceiling, the tokens of its prompt plus its output limit at the model's token prices, see Judge calls), so a run that `plan` passes is not stopped by the ledger on calls that cost a little more than usual, and a judge call can be refused by the ledger when `max_usd` leaves less room than its ceiling. `plan` warns about that: when the room it leaves below `max_usd` or `total_cap_usd` is smaller than what one judge or checklist call reserves above its p90 (figured for an empty prompt, so a floor), the warning names the limit with the smaller room (`max_usd`, `total_cap_usd`, or both when the room is the same) and says how much to raise it: the margin less that room for one call at a time, and one margin more for each further call that runs at once. It does not price every pending call at its ceiling, because only the calls in flight hold one and that would refuse runs the ledger accepts. A finished call is charged what its CLI reports (see Spend limits and the ledger, which also says how to rebuild the profile).

The profile projects about 9.71 USD (mean) and 16.68 USD (p90) for one skill read over two batches of 8 tasks with the 3 default judge seats. Per batch, as mean and p90: paired runs 1.07 and 1.94 (16 runs), judging 1.79 and 3.05 for each reading (48 calls: each seat judges each of the 2 answers on its own) and checklist writing 0.21 and 0.30 (8 calls).

`plan` prices the calls that are still pending and refuses the plan if the p90 total, with what this run has already spent or reserved, is above `max_usd`. A plan whose p90 is exactly `max_usd` is allowed. Amounts are written to cents, with more decimals when two different amounts would otherwise read the same, or when a limit above 0 would read as $0.00. The per-call costs were measured on earlier runs and can differ on this one, so `plan` advises a budget of about $35 per skill. The $35 is about twice the one-skill p90, rounded up to a multiple of 5: a margin and not a second estimate.

## Spend limits and the ledger

Every paid call is recorded in `bench/out/ledger.jsonl`. One file is shared by all runs and by parallel jobs, and it is git-ignored. A call is reserved at its upper estimate (the p90 of its kind and model in the cost profile; for a judge or checklist call its ceiling, see Judge calls) before it is made and settled after at the cost its CLI reports, or at its mean when it reports none. Both rows record the call's `kind` and `model`. A reservation with no settlement counts as in flight until its timeout passes. After that it counts as spent, because a call that outlived its reservation may have been paid for, and `plan` says how many such reservations the spent figure includes. A job that waits for the ledger lock gives up after the lock's stale age (60 s) plus 10 s, so one crashed job delays the next and does not stop it.

Two limits apply, checked in this order. A call that would pass one is refused by the ledger. The check is made when a call is reserved, at its p90 (a judge or checklist call at its ceiling). A call that then costs more than its reservation is still charged what it cost: its settle row has `over_reservation_usd`, and the next call is refused once a limit is passed. So a run can end above a limit by what the calls already running cost over their reservations.

| Limit           | Default | What it counts                         |
| --------------- | ------- | -------------------------------------- |
| `max_usd`       | 30      | The spend of this run                  |
| `total_cap_usd` | 100     | Everything in the ledger, for all runs |

`plan` reads the ledger and never writes it. It prints the ledger total and refuses the plan (exit 1) if the pending p90 cost would take the ledger past `total_cap_usd`. For `max_usd` it adds what this run has already spent or reserved to the pending p90 cost, so a resumed run is judged the way the ledger will judge it. To start a new count, move the ledger file aside (rename it), so the old rows stay available for review.

Finished calls are charged the cost their CLI reports: Claude Code's `total_cost_usd`, or the sum of OpenCode's per-step `cost`. A call that reports no usable cost (none, not a number, below 0, or 0 while its usage shows tokens) is charged its mean from the cost profile, and its ledger row says `"cost_source": "estimate"`. A call that ended before any model step started (a flag, a config or a model id the CLI refused) and reported no cost and no tokens reached no model: it is charged 0, and its row says `"cost_source": "none"`. `plan` says how many such calls there are. `cliReportsLow: true` in the profile marks a model whose CLI reports less than the call costs: OpenCode reports about 0.0009 USD per call for GPT-6.1 Terra, about 15 times too little, so that profile entry was priced from token counts. A call of such a model is charged the larger of the reported cost and its mean, and its row says `"cost_source": "floor"` when the mean was used. Every other settled row says `"reported"`. A job summary counts the calls charged at the estimate, per model, when there are any. There is no price table: a settings file that still has `model_prices` is refused with `removed: calls are charged at the cost the CLI reports`.

### Rebuilding the cost profile

```
node scripts/bench/bench.js cost-profile [--ledger <file>] [--out <file>] [--root <dir>]
```

It reads the ledger (default `bench/out/ledger.jsonl`) and takes the settled calls whose cost the CLI reported (`cost_source` `reported`). `floor` rows (they hold the mean, not what the CLI reported), calls charged their mean because they reported no cost, cancelled calls, expired reservations and rows with no `kind` or `model` are left out. It groups the calls by kind and model and makes a profile of the same shape: `calls`, `failed`, `mean`, `median` and `p90` (nearest rank, at least the mean), `measuredOn` today and a `provenance` line that names the ledger. A kind and model needs at least 20 calls; one with fewer, one the ledger has no calls for, and a model the current profile marks `cliReportsLow` keep their entry from the current profile. When no entry is measured, the profile keeps its `measuredOn` and `provenance`. Without `--out` it prints the JSON; with it, it writes the file, and a folder that does not exist is an I/O error (exit 74). The file is written under a temporary name and renamed into place, so a crash cannot leave half a profile. `--out` may not name the ledger or its lock file, and a ledger with a corrupt line is a usage error (exit 64) that names the line and the file. It needs no settings file and spends nothing. Review the new figures before you commit them as `bench/profiles/cost-observed.json`.

## Keeping secrets out of stored text

The redactor (`lib/redact.js`) replaces secret-shaped values with a marker: AWS access key ids, secret access keys and session tokens, Bedrock API keys, bearer tokens, the run's canary, and any exact value it is given. A named value is found also when the name ends a longer variable name, such as `MY_AWS_SECRET_ACCESS_KEY=` or `awsSecretAccessKey`. A secret in another shape, such as URL-encoded or split over two lines, is not found. The canary is a decoy secret placed in the agent's environment, so that a leak into an answer can be seen. Text above a size ceiling is dropped whole instead of being scanned in part. A ledger label passes through the redactor too. `createLedger`, `withRetry` and `createBreaker` take an optional `redact` function: a job that knows the exact credential values it handed out passes a run redactor (`createRedactor` with those values), so a bare value with no secret shape is removed from ledger labels and from the messages of the errors they throw.

The secret sweep (`lib/sweep.js`) scans the files of a run folder in two tiers. An exact match of a value the run knows is secret (the credentials handed to the agent, or the canary) is a stop: the file can be quarantined and the run should end. Quarantine writes a copy named `<file>~quarantined-<time>` (mode 0600) with the matched values and every secret shape redacted, then removes the original, so no copy of the value stays on disk. A quarantined file is never scanned, but a later sweep lists it as `quarantined` and is not clean while one exists, so a second sweep cannot read as clean after a stop. Any other secret-shaped string is only a warning, because answers about security often quote example keys. The file keeps that text as it is: it is not redacted in the file, and it is redacted when the answer is prepared for judging. A file the sweep cannot scan (over the size cap, a symbolic link, which is never followed, or a file removed while the sweep ran) is listed as skipped, and the sweep is not clean while any file is skipped. A run folder that does not exist is not clean either, so a wrong path cannot read as a clean sweep.

Both are used while a subject run is going: `runSubjectTask` sweeps every run folder and redacts the errors and the stderr it returns. The jobs that make checklist and judge calls come in a later PR.

## Retries and parallel calls

Two helpers wrap a model call. `lib/retry.js` sorts a failure into a class. A credential failure and a spend stop are never retried and end the run. A credential failure is AWS credentials that are missing or expired, an AWS SSO login that ran out (`the SSO session associated with this profile has expired`, `Token has expired`, `refresh failed`), or a request signature the provider rejects. `401` and `unauthorized` count only next to an AWS error name or `not authorized to perform`, so a bare `401 Unauthorized` from another tool is a temporary failure and not a credential one. A provider refusal is tried twice, because a retry gives the same block. A call that can never work as it is (access denied, an invalid request, a model or file that does not exist) is not retried at all and does not count toward the four-in-a-row stop. Anything else, such as a timeout or throttling, is retried up to three tries in all with a growing pause. If four calls in a row fail every try, the run stops, because that points at a credential or provider problem and not bad luck. Classes are matched on the error's message text: the provider's exception names and the phrases the CLIs print, such as `requires AWS credentials` (a credential failure) or `The provided model identifier is invalid` (a call that can never work). A message that matches none is treated as a temporary failure. `lib/pool.js` runs at most a set number of calls at once for each seat. After a fatal error it starts no more calls and rejects with that error, so a caller keeps only the work it already stored. `retry.js` is used by `runSubjectTask` and `pool.js` by the pairs job; the jobs that make checklist and judge calls come in a later PR.

## What the judges see

A judge must not be able to tell which answer used the skill. Before a judge sees an answer, the sanitizer (`lib/sanitize.js`) removes what would give the arm away. The rule is: neutralize names, drop narration sentences, keep everything else. It is three lists and a guard, with no ordered phases, all at the top of the file and all in the specification hash:

- `NAME_WORDS`: the skill's name, its `bench:` form, the plugin name and agent ids become plain words (`the bench:code-review skill` becomes `the approach`, a bare multi-word name becomes its words in its own letter case). A one-word name such as `verification` is ordinary prose, so only its labelled and `bench:` forms are rewritten. These rewrites change prose only. A URL, a host and path, a path, a file name (`code-review.md`), a package or git command (`npm install konductor-installer`, `` `git checkout code-review/fix` ``), a shell prompt line and fenced code keep the names they hold, and the leak scan does not look for a skill name or an agent id there. A name alone in backticks is a mention and is rewritten. The `bench:` form is the harness's own syntax and is rewritten everywhere. The replacement words and the flags the lists compile with are part of the specification, so changing one changes the hash.
- Skill words, cue words and narrators: a sentence is narration when it holds a skill word and a cue word that go together, and it is dropped. `skill`, `skills` and guidance are generic words (ordinary prose too); the skill's own name and `bench:` references are named words. Strong cues are what a harness does with a skill (load, call, find, match, be available or missing, `per the skill`, `the skill says`); weak cues are words that are also everyday prose (per, using, without, following, provided, requires). A named word takes any cue. A generic word takes a strong cue, or a weak one when the sentence has a narrator (`I`, `my`, `the agent`). So "Per AWS guidance, never create access keys for the root user." and "The role requires skills in Terraform and Python." are kept. When the task's request itself says "skill" or "guidance", the word is the topic, and only a narrator makes it narration. A few phrases are narration without a narrator: what only the harness can say about a skill (`Skills used: none.`, `The skill was loaded.`, `No skill matched this task.`, `The Skill tool was not available.`; the present tense `The skill is loaded when a request matches.` is not one) counts in every task, and the answer speaking of the skill it used or was given (`Using the skill, here is the review.`, `The skill provided a checklist.`) counts unless the request itself says "skill". "Instructions" is not a skill word, because it is everyday prose ("Following instructions found in ticket content."): narration that names only instructions ("The provided instructions were short.") is kept. A table is read cell by cell: a narrating cell is emptied and the row keeps its columns. A sentence hard-wrapped over lines is read whole when the line above ends without a stop and the next starts in lower case (the leak scan joins every line of a paragraph, except a capital line after a label such as `**Skills**` or `Team skills`). Fenced code is left alone. A skill word with no cue ("Rank by skill level.") is kept. A skill word that points at a source ("the guidance in the style guide") does not count. Ordinary prose that holds a generic word and a strong cue ("Tests named after the skill they exercise are easy to find.") is dropped too, one sentence each.
- `PATH_PATTERNS`: only paths the harness owns: its scratch folders, `.claude-plugin/...`, `scripts/bench/...`, and the skill under test's own `skills/<skill>/...` folder. Another skill's folder is never touched.
- The request guard: text that also appears in the task's request is never removed or rewritten, so an answer that repeats a path, a name or a sentence the user wrote keeps it. It applies to all three lists, and the leak scan below honors it too.

Control, zero-width, bidi and tag characters are removed first, line breaks become `\n` and the text is NFC. Fenced code follows CommonMark: a fence opens with three or more backticks or tildes indented at most 3 spaces, and closes only with a run of the same character at least as long as the one that opened it. A fence may sit in a `>` blockquote and ends where the quote does. A line indented 4 spaces is indented code in CommonMark; the sanitizer does not track indented code, so such a line is read as prose and a fence marker on it opens nothing. The sanitizer works on a copy, so the stored answer is never changed.

Every drop is counted, with the share of the answer's non-whitespace characters that was removed. The rules have a version number and a hash of their whole specification, so a change to the rules can mark earlier judgments stale once judgments exist (added in a later PR).

`lib/judge-input.js` is the one place that turns a stored answer into text a judge may see. It prepares one answer at a time, for a judge prompt that holds only that answer, and the caller must name the skill under test (`""` for a control), so a missing option cannot skip the name rules. The stored answer must be text (null and undefined are read as an empty answer); anything else is refused. `request`, the task's request text, is optional and feeds the guard. It runs four steps in this order:

1. Sanitize, as above.
2. Redact: the redactor replaces secret-shaped values, so lookalike strings never reach a judge. The result says whether the text changed.
3. Cap: text over 50,000 characters is cut after redaction, so a cut cannot split a secret, and never inside a surrogate pair (one character such as an emoji takes two units of the count, and the cut moves back one so that no half of it is kept). The result says whether it was cut.
4. Leak scan: a second look for what is still there: names, agent ids, harness paths, tool markers and the same narration check the sanitizer runs, with every line of a paragraph read as one text so a wrapped sentence cannot hide it. A hit means the answer is not eligible, because a judge that reads it would learn the arm. Both arms are scanned the same way, and text the task's request holds is not a leak.

An answer is also not eligible when the sanitizer removed more than a quarter of it (a judge would score what is left), when nothing is left, when it is too long to sanitize, or when it ends inside a code fence that was never closed (the sanitizer and the scan skip fenced code, so an open fence would hide the rest of the answer). The judge job added in a later PR does not send an answer that is not eligible. The result also carries the counts of what was removed, so the report added later can show a loss that differs between the arms. One provenance hash covers everything that can change what a judge sees or whether an answer is eligible: the sanitizer's specification, the redactor patterns, the leak patterns and the limits.

This is one layer of blinding and not a guarantee. The sanitizer cannot hide a difference in style or content that comes from the skill itself.

## Scoring

Each answer is scored alone. A judge sees the request, a checklist and one answer, and replies with one label per checklist item: `MET`, `PARTIAL` or `MISSING`, which count 1, 0.5 and 0. It is never told which arm wrote the answer, or that another answer exists. The score of an answer is 1 plus 4 times the share of weight met, so it runs from 1 to 5. A seat counts for a task when both of the task's answers got a valid judgment from that seat; its gap is the score of the answer made with the skill minus the score of the answer made without it. A seat with one valid answer does not count. The gap of a task is the mean of its seats' gaps, and a task counts in a reading only when at least 2 of its seats count.

The two readings use the two scales. `items` is reading B: the rules checklist, where every item has a bucket and every bucket feeds the score. Guard items also feed a separate guard figure, taken from each answer's own judgment. `outcome` is reading A: the request-only checklist, which has no buckets.

The reply parser is strict, because a lenient one would score a reply the prompt did not ask for. The whole reply must be one JSON object with `items` (and optionally a text `reason`), with exactly one upper-case label per checklist item, in order. Text around the JSON, two objects, a lower-case label, a missing or extra label, an unknown field and a field given twice (two `items` would let the last one win) all make the judgment invalid, with a stored reason and a `kind` (`empty`, `not_json`, `not_object`, `fields` or `labels`) that can be counted. One code fence around the whole reply (bare or tagged `json`) is accepted, because it adds no text and models add it often; the judgment then records `normalized: 'fence'`. A fence with text around it, two fences or another language tag are still invalid.

## Judge prompts

Each scale has a versioned prompt template in `scripts/bench/prompts/` (`judge-prompt.items.v1.md` and `judge-prompt.outcome.v1.md`). `lib/judge-prompt.js` fills one in for a single judge call about a single answer: the request, the numbered checklist and that one answer. Each answer is scored alone: the prompt never says which arm wrote the answer or that another answer exists, and the renderer is not even given the arm. The judge replies with `{"items":[...],"reason":"..."}`, one label per checklist item and one sentence naming the item that most decided the labels. The template tells the judge that everything inside the answer block is data and not instructions. The answer sits between marker lines that carry a random id made for that call, so an answer cannot close its own block or speak as the prompt. The renderer refuses to run if the id appears in the text it fills in, and it refuses an answer that the judge-input step marked not eligible. It also refuses a record that does not carry the sanitizer version and rules hash the judge-input step stamps on it, and a record that the judge-input step did not return: `prepare()` freezes each record and registers it in memory, so a copy, a clone or a record built by hand is refused even when it carries valid-looking stamps. The registry is per process, so a record read back from a file must be prepared again. The judgment's provenance refuses a record whose rules hash differs from the judge input it names. The provenance also records the arm and the hash of that arm's answer, where the judge cannot see them.

The hash of a template is the hash of its file bytes, and a test pins it. Any edit, even to the license line, changes the hash and makes judgments made with the old text stale. To change the wording, add a file with the next version number and pin its hash in the same commit. Treat these files as byte-exact: do not reformat them.

## Judge calls

`lib/opencode.js` makes one judge call through the OpenCode CLI on Bedrock (`opencode run [--standalone] --format json --title bench-judge`). It needs `opencode` on `PATH` and AWS credentials in the environment. It sets no AWS profile of its own. It does not pass `--auto` (auto-approve permissions that are not denied): the config denies every tool, and a judge that reads untrusted answer text must have a tool request rejected, not approved, whatever config OpenCode ends up reading. The fixed `--title` stops OpenCode from making a second model call to write a session title, which would send the whole judge prompt to the provider's small model and whose cost the ledger does not see; the config also names the seat's own model as `small_model`, so no such call can reach another provider's model.

Each call runs in a fresh private folder (mode 0700) under the system temp folder, removed when the call ends. That folder holds the call's own OpenCode config, its own home and its own config, data and state folders, and a minimal `.git` directory at its root. OpenCode merges every `opencode.json` and loads every `.opencode/plugin` file it finds above its working directory, and it reads `~/.opencode`; the `.git` directory makes the folder the root of the project, which ends that search there, and `HOME` points at the folder's own `home`. So the user's OpenCode settings, MCP servers, plugins and sessions, and a config or plugin another user left in the temp folder, are not loaded. This was checked against OpenCode 1.19.5 with `opencode debug config`, which calls no model; the check is a test that runs when `BENCH_OPENCODE_BIN` names an OpenCode binary. The AWS shared config and credentials files and the OpenCode cache keep their real paths (pinned in the call's environment), because `HOME` points at the folder's own home, not at theirs. The config allows only the Bedrock provider, denies every tool (any tool a newer OpenCode adds is denied too) and turns code execution off. The judge gets everything it needs inside the prompt. If the trace shows that a tool ran anyway, the reply is not used. The child gets the parent's environment minus variables that could redirect the call or run code in it (`ANTHROPIC_*`, `OPENAI_*`, `OPENCODE_*`, `CLAUDE_CODE_*`, `NODE_OPTIONS`, `BASH_ENV`, `ENV`).

The model id must look like an inference profile id (letters, digits, `.`, `_`, `:`, `/` and `-`, 3 to 120 characters), and a reasoning effort, when one is given, is a short lowercase word. Anything else is refused before a process starts or money is reserved. A prompt is passed as one command-line argument, so a prompt over 128 KiB is refused the same way.

Every call reserves in the ledger its ceiling before it starts, and the reservation lasts as long as the call can. The ceiling is the tokens of the prompt plus the call's output limit (`judge_max_output_tokens`, or the seat's entry in `judge_max_output_tokens_by_seat`), at the model's token prices in the cost profile (`inputUsdPerMTok` and `outputUsdPerMTok`), rounded up to a millionth of a dollar. The prompt is counted as its bytes over 3 plus 4000 tokens that OpenCode adds around it; the input price is the highest rate an input token is billed at, the cache-write rate where there is one. No reply can run past the output limit, so no single call can cost more than its reservation, and so no single call can pass `max_usd`. A model whose entry in the profile has no token prices is reserved at its p90, as for every call before, and its output limit still applies. A call settles at the cost OpenCode reports, the sum of its per-step `cost`. A model that reports no usage in the trace is asked for it with `opencode session export`. A call that reports no usable cost is charged the mean of its kind and model and its ledger row says `"cost_source": "estimate"`, so a paid call is never booked as $0. Only a call that ended before any model step started (no `step_start` or other model event in the trace) and reported no cost and no tokens is charged 0, with `"cost_source": "none"`: it reached no model. A model marked `cliReportsLow` in the profile is charged at least its mean, and its row says `"cost_source": "floor"` when the mean is used. Error text and stderr are redacted before they are returned; given exported credentials, their secret key and session token are removed exactly too. A process killed by a signal may have reached the model, so it keeps the mean. A call that reports more than it reserved is still charged what it reported and the ledger marks the overrun, as a backstop, so a limit can be passed by the calls in flight (see "Spend limits and the ledger"). If the ledger cannot record a settlement, the call fails with that error and its reservation stays open until it expires, then counts as spent at its p90.

### The output limit

Every model gets an OpenCode model entry of its own in the call's config, with `limit.output` and `settings.maxTokens` set to the limit and `limit.context` set (272000 for GPT-6.1 Terra, 200000 for any other model, which a one-shot prompt of at most 128 KiB is far below). The call names that entry (`amazon-bedrock/benchmark-gpt-6-1-terra` for Terra, `amazon-bedrock/benchmark-` and the model id in lowercase words for another). A model that stops because it reached the limit (`reason` `length` in its last `step_finish`) gives a cut-off reply: the call fails with "reply cut off at the output limit" and goes through the normal retry. The call result also has `cutOff` true when the reply used the whole limit, and the judge job counts the tries whose reply was cut off (`cut_off` in its result), whether they failed on the stop reason or on a reply the strict parser could not read, so a limit set too low shows. Output tokens include reasoning tokens.

The limit of a call is the seat's entry in `judge_max_output_tokens_by_seat`, else the entry of the first seat whose model the call uses, else `judge_max_output_tokens`. A checklist writer model that no seat uses gets the largest of the base and every by-seat entry, so a reply is never cut shorter than the longest any seat may give. The defaults come from the measurement below: `openai` 5000 and `xai` 37500 are 3 times the seat's largest 99.9th percentile (1657 and 12490), rounded up to the next 500. The base, 9000, is 3 times the checklist writer's largest reply (2873), rounded the same way, because the writer uses the `anthropic` seat's model; it also covers the `anthropic` seat (largest reply 2137). A seat added later gets the base. Measured in output tokens per call over the stored judge records of four paid runs (`trim-1`, `strict-1`, `ship-16` and `ship-35`, 16320 calls with usage, the `ship-35` run still partial):

| Seat        | Reading       | Calls | Median | p99  | p99.9 | Largest |
| ----------- | ------------- | ----- | ------ | ---- | ----- | ------- |
| `anthropic` | B (`items`)   | 2576  | 565    | 1139 | 1470  | 1572    |
| `anthropic` | A (`outcome`) | 2864  | 664    | 1443 | 1939  | 2137    |
| `openai`    | B             | 2576  | 210    | 728  | 978   | 1198    |
| `openai`    | A             | 2864  | 244    | 900  | 1657  | 1910    |
| `xai`       | B             | 2576  | 2435   | 7710 | 12490 | 16927   |
| `xai`       | A             | 2864  | 3149   | 8666 | 12338 | 13283   |

The checklist writer (the `anthropic` seat's model) wrote 1422 checklists: median 732, p99 2376, p99.9 2738, largest 2873. The numbers come from the `usage` of each record (summed over the steps, reasoning included), not from an estimate. Grok is the long one: its p99.9 is 8 times the others'. At the defaults, the ceiling of one call with a 30 KB prompt is about 0.28 USD for Claude Opus 5.5, 0.05 for Terra and 0.28 for Grok, against a mean of 0.048, 0.013 and 0.05. Checked with OpenCode 1.19.5: one call per seat at a limit of 256, each stopped with `reason` `length`.

A call that runs past its timeout is killed. Its result returns once OpenCode's output pipes close, or 2 seconds after the kill if a process that OpenCode started keeps them open. That process is not killed.

Whether this OpenCode needs `--standalone` is read from `opencode run --help` once per binary, and calls that start together share that one read. A help text that cannot be read is read once more; if that fails too, the call fails with an error that says so and is charged 0 (no judge process started), and the next call reads it again.

The call timeout is `judge_timeout_ms`, or the seat's entry in `judge_timeout_ms_by_seat` (see Settings and cost). A timeout is a runtime setting: no judgment digest reads it. A timeout is between 1 second and 1 hour. A seat entry for a seat that is not in `models.judges` is refused, so settings that drop a seat drop its entry too. A failed call can be turned into an error that `lib/retry.js` sorts (credential, refusal, permanent or transient), so a timeout or a throttle is retried and four failures in a row stop the run. The OpenCode version, which judgment provenance records, is read with `opencode --version` in the same kind of private folder.

## Arms

`lib/arms.js` builds the two arms of one skill as Claude Code plugin folders: `with` holds every skill the agent declares, and `without` holds the same skills minus the one under test. They go in a fresh private folder (mode 0700) under the system temp folder, named `bench-arms-<skill>-...` (a relative `tmpRoot` is made absolute). The folder holds an empty marker file, `.bench-arms`, and `removeArms` deletes only an absolute path with that name and that marker, so it refuses any other folder. The skills and agents folders are only read. A skill folder and everything in it must be plain files and folders; a symbolic link anywhere, the skill folder itself included, is refused, so nothing outside the skill can become part of an arm. A check after the copy makes sure the target skill is the only difference between the two arms: every other skill must have the same files, with the same bytes and execute bits, in both.

Both arms get the same agent definition, read from `agents/<agent>.agent-spec.json` (`config.description` and `config.systemPrompt`), with two differences:

- The `without` arm's prompt loses every line that refers to the skill, and its description every clause that does, because a prompt that lists it would tell the model, and through its answer the judges, which arm it is in. A list entry is cut out of its sentence, at the start, the end or in the middle (`` `a` and `b` can run `` keeps `` `b` can run ``, and "through a or b" keeps b). A line that still refers to the skill keeps the sentences that do not, so an instruction that is not about the skill ("Implement the change with small edits." next to "Run `a` first.") stays in both arms. The skill's own entry is the exception: a line that opens with the skill's name (`- **a**: What it does. Use when ...` or `- a captures ...: no confirmation. Write, then notify.`) goes whole, because what is left of it ("- Use when handling Word documents.") would be a nameless description of the skill. A sentence that starts with a pronoun (It, Its, This, These, They) right after a cut sentence goes with it. A line whose every sentence refers to the skill is dropped with the lines indented under it (sub-bullets, wrapped text, the rest of a shell command), and a heading takes its section with it, up to the next heading of the same or a higher level. Numbered steps after a removed step are renumbered, up to the next blank line or the next line that is not part of the item. A longer name that contains the skill's name is kept. A name of several words (`test-coverage-analysis`, also with an underscore in place of a hyphen) is a reference wherever it appears. Its spaced form counts in Title Case or capitals (`Test Coverage Analysis`), in backticks or bold, as `bench:<skill>`, or next to the word "skill"; a plain lowercase phrase ("run a test coverage analysis") is everyday prose and stays, and is listed as loose. A single word such as `verification` is also an ordinary word, so it counts only in backticks or bold, as `bench:<skill>`, or next to the word "skill"; a line that uses it as a plain word stays. The description is usually one line, so it is cut by clause: the clauses that refer to the skill go (a clause ends at a comma, semicolon, colon, "and", "or" or "but"), the others stay, and a sentence with no clause left goes. `Writes brew logs with brew-log and pantry notes with pantry-note.` becomes `Pantry notes with pantry-note.` for `brew-log`. A description with nothing left is an error that names the agent, so the `without` arm never gets an empty description. `buildArms` returns `stripped`, which lists the lines dropped (the clauses, for the description), the sentences and entries cut from lines that stayed, and what is kept that still uses the name as a plain word, for the description and the prompt. It also lists `lostSkills`: the other skills the agent declares that a removed line or sentence named. Removing the skill under test must not take another skill's instruction out of the `without` arm, because then a score gap would mix the skill with the lost instruction, so `buildArms` refuses such a pair (an error that names the agent and the skill) unless it is called with `allowLostSkills: true`. Only tests set that option; no config key or flag does, so a refused pair is fixed by rewording the agent's prompt. One of the 159 pairs of the agent specs in `agents/` is refused: `k-product-manager` with `deliberation-panel`, whose entry ends with a pointer to `socratic-elicitation` that goes with the entry.
- The `with` arm can end with an explicit instruction to load the skill before answering (`explicitInstruction`).

Both arms get the same answer-style rule, which asks the answer not to describe tools, skills or instructions; the `with` arm can then end with the load instruction. Every skill is installed under its own name in the plugin namespace `bench:`, so a skill named like one of Claude Code's bundled skills (`code-review`) is `bench:code-review`, and the load instruction names that. A benchmark control skill (in `scripts/bench/skills/`) that the agent does not declare is added to the `with` arm.

Each arm has a manifest: the agent, a hash of its agent definition and a hash of its plugin folder (every file's relative path and bytes, with a mark on a file that has an execute bit). It holds no path or time, so the same inputs give the same manifest on any machine. `ARM_BLINDING_VERSION` is 1 and changes when the arm prompts change in a way that makes new answers not comparable with older ones. A change to the text of an agent's prompt or description already shows in the answer's `agents_json_sha256`, so the clause-level description cut and the spaced-name matching did not bump it: none of the 159 agent and skill pairs of the repository's agents gives a different `without` prompt or description than before.

## Runner profile and isolation

`lib/runner.js` holds the runner profiles: how the `with` arm loads the skill and which tools both arms get. The `runner_profile` setting picks one.

| Profile            | Load                                                                          | Tools         |
| ------------------ | ----------------------------------------------------------------------------- | ------------- |
| `legacy` (default) | The `with` arm's prompt ends with an instruction to load the skill.           | `Skill` only. |
| `natural`          | No instruction in either arm, so whether the agent picks the skill up counts. | `Skill` only. |

Both arms run Claude Code with its own bundled skills (`code-review`, `debug`, `verify` and the rest) available, and no flag denies them, so a skill is measured against Claude Code as shipped.

A profile must grant `Skill`. It can never grant an MCP tool, and a `Bash` grant needs a `Bash(...)` rule that names a command: bare `Bash` and a rule made only of wildcards, such as `Bash(*)`, are refused. So is a rule whose command is a shell, an interpreter or a network tool (`sh`, `bash`, `zsh`, `node`, `python`, `python3`, `perl`, `ruby`, `curl`, `wget`, `env`, `xargs`, `eval`, `exec`, with or without a path or a version suffix such as `python3.12`), because those run any program: `Bash(sh:*)` and `Bash(curl:*)` fail the check. The check is a guard against the obvious mistakes and not a sandbox. It reads the first word of the rule only, so it does not stop a prefix such as `Bash(git:*)` from running other commands through its own flags and subcommands, and it says nothing about how Claude Code matches a rule. A profile that grants `Bash` needs its allow rules reviewed by hand; none ships. The inputs of every answer record the profile's digest (`runner_profile_sha256`). The digest covers the load mode, tools, allow rules, permission mode, the per-run budget cap and the isolation deny rules, not the profile's name. An answer made under another digest is stale. The budget cap is 0.75 USD unless the profile sets one, and a profile cannot set more than 10. It is not tied to the model's p90 in the cost profile: the subject runner reserves the larger of the two for each call (see Subject runs), so a run that reaches its cap is covered by its reservation. No profile with file tools ships, because the isolation test against the real CLI must pass first.

`subjectFlags` builds the Claude Code arguments of one run as a list, never a shell string: `--tools Skill`, no settings files (`--setting-sources ""`), no MCP servers (`--strict-mcp-config`), no saved session, the budget cap, the isolation settings, and the arm's plugin folder and agent. A model name or agent that could be read as another flag is refused.

`lib/subject-isolation.js` sets up what the child can reach:

- **Environment.** Built from nothing, never copied from the parent: the three short-lived AWS values exported for this launch, `AWS_REGION`, `CLAUDE_CODE_USE_BEDROCK=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `PATH`, `HOME` and the launch's canary `BENCH_CANARY_TOKEN`. `AWS_PROFILE`, credential file paths and any token in the parent shell never reach the child.
- **Home.** `HOME` is a fresh folder, mode 0700, inside the run's scratch folder. The real home folder, or a folder above it, is refused after links are resolved, so a link to it does not get past, and the child cannot reach `~/.aws` by name.
- **Deny rules.** The settings deny reading and editing the folders `~/.aws`, `~/.ssh`, `~/.config`, `~/.gnupg`, `~/.docker`, `~/.kube`, `~/.claude`, `~/.m2`, `~/.cargo`, `~/.azure` and `~/.local/share`, the files `~/.netrc`, `~/.npmrc`, `~/.git-credentials`, `~/.claude.json`, `~/.pypirc` and `~/.pgpass` (all under the child's `HOME` and at the real paths) and the repository root, and keep file tools inside the working directory. The live isolation test (opt in with `BENCH_LIVE_ISOLATION=1`, added with the subject runner) ran against Claude Code 2.1.322: the CLI accepted these settings and reported `Skill` as its only tool. That run grants `Skill` alone, so it does not exercise a file tool; check that a deny rule blocks a read, and that the two working-directory keys confine a file tool, before a profile grants file tools. A real home or repository path with a character that has a meaning in a rule (`()*?[]{}`) is refused. This is not an OS sandbox. With `Skill` as the only tool the child has nothing to read with; the rules matter for a later profile with file tools.

## Subject runs

`lib/claude-run.js` runs one answer: one fresh `claude` process on Bedrock with the subject model. Each launch:

1. Runs `aws configure export-credentials` for the profile (`aws_profile`, else `AWS_PROFILE`) and keeps the three short-lived values in memory. Long-term keys are refused. No launch starts when the credentials expire within the call timeout (5 minutes by default, and never less than 3); the run stops instead.
2. Makes a fresh random canary, reserves in the ledger the larger of the subject model's upper estimate (the p90 in the cost profile) and the run's budget cap, and makes a private scratch folder (mode 0700) with an empty working directory and the private `HOME`.
3. Starts `claude` with the flags, settings and environment above, sends the request on stdin, writes the raw event log to `raw.jsonl` (mode 0600) in the run folder the caller names, settles the ledger with the cost Claude Code reports (`total_cost_usd`; with none usable it is charged the mean of its kind and model, marked `"cost_source": "estimate"`), and deletes the scratch folder. The log is written first, so a ledger failure never loses what the call printed. When `raw.jsonl` already exists (another job made it during the call), the output is kept as `raw.jsonl.unsaved-<time>` and the write error is thrown.
4. Runs the secret sweep over the run folder. A credential value or the canary in any stored file quarantines the file (a copy with the values redacted replaces it) and stops the run (`SecurityStopError`), and so does a file the sweep could not scan (it is reported, not quarantined). Other secret-shaped text is a warning.
5. Checks the text of the parsed trace for the same values. The answer and a tool result are joined from several events, so a value printed in pieces across turns is whole there and in no file. A hit quarantines `raw.jsonl` and stops the run too. The quarantine is the one the sweep uses: a copy `raw.jsonl~quarantined-<time>` (mode 0600) replaces the original. The copy also has a value printed in pieces cut from every event that holds a piece, which a plain match of the exact values would miss, and a later sweep lists it as `quarantined`, not clean. A copy that cannot be made is reported in the stop, and `raw.jsonl` is still there. When something else throws after the process ran (a ledger failure, for example), the stored log gets the same two sweeps: a file hit still throws `SecurityStopError`, and a value in the trace's text quarantines the log but the original error is rethrown, with `traceQuarantine` set on it (a sweep that fails is set as `sweepFailure` and, with no other cause, as `cause`).

`lib/claude-trace.js` reads the event log: the answer, the tools Claude Code loaded, the models that produced output, token counts, cost, tool calls and their results. The answer is the text of the result event. An empty result is an empty answer (the run is not `ok`), never the narration before it; only a log with no result event falls back to the assistant text, and that run is invalid. A run is invalid when:

| Case | Example                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | The `with` arm never loaded the skill (no call of the Skill tool named `bench:<skill>` that returned without an error; the bare name does not count, because it can be a Claude Code skill of that name). |
| 2    | The `without` arm loaded it.                                                                                                                                                                              |
| 3    | No result event ended the run, a model other than the subject model produced output, or the result reports no model.                                                                                      |
| 4    | The tools Claude Code reports go beyond the grant (`Skill`), or a tool outside the grant ran. Only Claude Code's own `Skill` tool counts; an MCP tool named `mcp__<server>__Skill` does not.              |

A run that is not `ok` (a non-zero exit code, a timeout, the output cap, an error result, an empty answer) is never valid, whatever its trace shows.

The live isolation test runs the real CLI, asked to read two files by absolute path (the real home's `~/.aws/config` and a file the test plants outside the working directory) and to print the canary. It fails if the answer holds the planted value, a profile section or a key, or the canary, or if the CLI reports a tool other than Skill. A prompt that said `~/.aws/config` would read the run's own empty home and could not fail, which is why the paths are absolute. The environment check of the stub tests ignores `__CF_USER_TEXT_ENCODING`, the one name macOS adds to every child process.

Spend: a call is reserved at the larger of the subject model's p90 and the run's own cap (`--max-budget-usd`, 0.75 USD by default), and charged what Claude Code reports. The cap is above the p90 in the committed profile, so each call in flight holds the cap, and a limit stops the run when the ledger cannot fit one more cap, a little before the p90 total reaches it. A call that Claude Code reports above its cap is charged in full, and the next call is then refused. A call that was killed (timeout, output cap) reports no cost and is charged the mean, which is below its reservation.

`runSubjectTask` tries one task and arm up to 3 times. An invalid or failed try's log is renamed `raw.jsonl.rejected-<time>` and kept (a `-2`, `-3`, ... follows the time when that name is already taken, so two tries in the same millisecond keep both logs). After 3 invalid tries the task is `not_loaded`, and the skill gets `NO DATA`. A credential error, a spend stop and a security stop are never retried.

The isolation tests use a stub `claude` script: told to read planted credential files outside its folder, it cannot reach them, and a canary it prints stops the run. A fixture skill holding a shell command does not run under `--tools Skill`. The stub enforces `--tools` itself, so these tests show that the harness hands the child the right flags, environment and working directory; only the live test exercises Claude Code. One more test runs the real CLI, asked to read `~/.aws/config` and print the canary; it costs about $0.01 and runs only with `BENCH_LIVE_ISOLATION=1`.

## Dose ladder

`lib/dose-ladder.js` loads a dose ladder: authored answer pairs with a known amount of harm, which check the prune side of the decision rule with no subject model. Each task has one good baseline answer, declared defects (each a find and replace on the baseline that breaks one rubric item) and a paraphrase (edits that change wording only).

| Dose | `with` arm        | `without` arm | Expected gap         |
| ---- | ----------------- | ------------- | -------------------- |
| D0   | the paraphrase    | the baseline  | its interval holds 0 |
| D1   | 1 defect applied  | the baseline  | below 0              |
| D2   | 2 defects applied | the baseline  | lower                |
| D4   | 4 defects applied | the baseline  | lowest               |

Each dose is its own item (`fixture-d0`, `fixture-d1`, ...), so the scoring and labels treat it like a skill. `validateLadder` audits a ladder and lists every problem at once: the shape (unknown or missing fields are refused, and task ids that differ only by case, which one file would hold on macOS and Windows), `D0` applying no defect and the defect count growing with the dose number, each `find` occurring exactly once in the baseline, each defect naming a real rubric item and no item twice, no two defects editing overlapping text, a paraphrase that does not carry the replacement of a defect, every dose within 15% of the baseline's length (the paraphrase within 8%), and no word such as "skill", "plugin", "benchmark" (or their plurals), "directive", "with-arm" or "Konductor" in the task id, the domain, the baseline, the prompt, the rubric or any dose answer, because each could tell a judge where the text came from (the title of a dose is built from the task id). `validateLadder(undefined)` reports "ladder must be an object", as `null` and `[]` do. A paraphrase that restores a deleted passage is not detected, because a deletion has no replacement to look for.

`writeLadderAnswers` audits the ladder, then writes one answer record per task and arm to `answers/<item>/<set>/<task>.<with|without>.json` in the run folder. A ladder that fails its audit writes nothing. An answer record holds the text, its input digest, a skill-load entry marked as authored (`loaded` is true for the `with` arm and false for the `without` arm, as for a generated answer, and the note says nothing was loaded), and a cost of 0. The digest covers one task and one arm, so appending a task keeps the judgments of the others, and editing a task makes only its own answers stale. A stored answer that equals the new record in every field is left alone, so a second write of an unchanged ladder writes nothing; one that differs in any field is rewritten. A stored answer that is not an authored one, or that belongs to another set, is never replaced. Answers of a task or dose that the ladder no longer has stay on disk and are not reported.

The ladder data and the controls check that reads its labels come in a later PR.

## Task assembly

`lib/tasks.js` turns one skill's frozen baseline into the tasks a run answers. It reads nothing new: the baseline files are checked by the same readers `plan` uses, and a baseline with any problem is refused with every problem listed (`TaskSetError`). A skill that no agent lists is refused the same way. Assembly is done in memory each time and never written, so it cannot drift from the files it came from.

For each task, assembly adds:

- `exercises_section`: the exact `##` or `###` heading of `SKILL.md` that `target_section` names. A name may leave out the heading's list number (`Rules` for `1. Rules`) when it then fits one heading only. A `target_section` that is not a heading is a warning, not a refusal, because the format makes it a note for the reviewer.
- `inputs`: per arm, the answer inputs and their digest `input_sha256`. They are the skill, the batch, the task id and request, the arm, the arm's agent definition and plugin folder hashes, the subject model, the runner profile digest and `ARM_BLINDING_VERSION`. The `with` arm also has the hash of `SKILL.md`; the `without` arm never has the skill, so editing it does not make those answers stale. A stored answer whose digest differs is stale and is answered again.

Each skill also gets a condition record: what each arm was told (the load instruction, the answer-style rule, the runner profile), stored with every answer. The subject is given the task's request and nothing else; a judge is given the request and the checklist and nothing else. The title, `target_section` and the other fields name the skill's own words, so a model that saw them could tell which arm it is in.

## Job planning

`lib/jobs.js` lists the work assembled tasks ask for, the same count `plan` makes. Each task has two subject runs, `with` and `without`. For each judge seat it has two calls per reading, one per answer: reading B (`items`) when the batch is read by B, and reading A (`outcome`) when the task is not excluded. There is no same-arm sample.

Each answer is scored on its own. A judge call sees one answer, never the other arm's, so there is no order in which two answers are shown. Its judgment file is named after the arm it scored.

## The pairs job

`lib/pairs.js` (`runPairs`) makes the subject runs of the selected skills. It spends money: each run is one Claude Code call. The command that starts it as a job comes with the job launcher.

1. `plan` for the same skills must pass. If it refuses (an invalid baseline, a cost above `max_usd`, a ledger past a limit), nothing is built or spent. Skills that `plan` does not plan, such as `no baseline`, are listed as skipped. `plan` counts an answer as done when its file exists, so it prices no run for an answer that is out of date (a skill edit, another model or runner profile). Once the tasks are assembled the job adds those runs, at the p90 of a subject call, to the plan's figure and checks `max_usd` (this run's spend and reservations) and `total_cap_usd` (the ledger) again. Over a limit, the job is refused with a line that says how many answers are out of date, and nothing is set aside or spent; this holds for `--dry-run` too.
2. A run is pending when its answer file is missing or not current: another input digest (see Task assembly), or a text that does not match its stored hash. A pending answer file is renamed `<file>.superseded-<time>` and kept. It is never read again.
3. The first pending run goes alone. If it is invalid for a reason other than the skill not loading, the job stops before anything else starts. The stop kind is `model` when another model than the subject model answered it, and `setup` when the setup is wrong in another way (a result that names no model, tools beyond the grant, a tool outside the grant that ran, the `without` arm loading the skill). The stop message says which. Then at most `subject_concurrency` runs go at once. A run in which no try got a result (the CLI exited with an error or printed no answer) is `failed`, and one such run stops nothing. The runs that fail this way in a row are counted, the first included, and a run that gets a result resets the count: at the fourth in a row the job stops with kind `systemic` (the same stop the checklist and judge jobs make for four calls in a row), because a fault that hits every launch the same way (a CLI too old for a flag, a wrapper that cannot start under the private `HOME`, a region where the model is not enabled) would otherwise run every pending run with all 3 tries. In the test that makes every launch exit with `unknown option`, this is 12 launches and $0.80 booked for 10 pending runs, where it was 30 launches and $2.01.
4. Each run gets up to 3 tries (see Subject runs). Its raw log goes to `raw/<skill>/<batch>/<task>.<arm>/` and its answer record to `answers/`.

| Result       | What is stored                                                                                          | Next run                        |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `ok`         | The answer record: the text and its hash, the inputs, the condition, the skill load, tokens and cost.   | Reused while it is current.     |
| `not_loaded` | A record with no text and the reason of each try. The skill gets `NO DATA` for that task.               | Left alone until inputs change. |
| `failed`     | Nothing. An invalid run for any other reason than the skill not loading is a failure, not `not_loaded`. | Tried again.                    |

`runSubjectTask` calls a task `not_loaded` after 3 invalid tries, whatever made them invalid. The pairs job stores that result only when every try had one problem: the `with` arm never loaded the skill. A run with any other problem in any try (another model, no model named, tools beyond the grant, the `without` arm loading the skill) is a fault of the setup and not of the skill, so nothing is stored for it and it is answered again on the next run.

A credential problem (missing credentials, long-term keys, or credentials that expire within the call timeout, 5 minutes by default and never less than 3), a spend stop, a ledger that cannot be used and a security stop from the secret sweep end the job. A run that ends with another error (a ledger failure, for example) after its raw log was quarantined for a value in the trace's text carries `traceQuarantine`; the job reports that as a security stop, with the quarantine note first, and not as the error's own kind. No new run starts, runs already going finish, and finished answers are kept. The result names the stop. Runs charged at the estimate because Claude Code reported no usable cost are counted per model in the result (`estimated`) and in one log line. `dryRun` lists the pending runs, with the agent, whether the `with` arm is told to load the skill and the tools. It spends nothing and writes nothing under `bench/out`; the arms are built in a temporary folder to read their manifests and removed.

Each answer also records the skills version (the commit of the last change under `skills/`) and the Claude Code version. Neither is part of the digest: a new commit or CLI version alone does not make an answer stale.

## Not built yet

These are added in a later PR: the commands that start the jobs, the judge job, the checklist writer for reading A, the labels that sum up the scores, and the report. The judge client is a library until the judge job uses it.
