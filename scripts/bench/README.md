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
| Run id    | The name of one run's folder under `bench/out/`. Default: `default`.                                                                                                                                |
| Stage     | A step of a run as `plan` lists it: 1 prep, 2 rules reading, 3 request-only reading, 4 report.                                                                                                      |

## Where files live

```
skills/<skill>/SKILL.md                      the skill under test (read only)
agents/*.agent-spec.json                     agents; one that lists the skill answers for it (read only)
bench/config.json                            the settings (git-ignored), see Settings
bench/exclusions.json                        tasks left out of reading A
bench/baselines/<skill>/rules.json           frozen rules
bench/baselines/<skill>/tasks-<batch>.json   frozen tasks, one file per batch
bench/baselines/<skill>/tasks-<batch>.buckets.json
bench/out/<run-id>/                          run data (git-ignored)
  answers/<skill>/<batch>/<task>.<with|without>.json
  checklists/<skill>/<batch>/<task>.json
  judgments/<items|outcome>/<skill>/<batch>/<task>.<seat>.<with|without>.json
  report.json, report.md
```

Everything under `bench/out/` is git-ignored. Baselines are committed. A small valid example of every file lives in `tests/fixtures/bench/repo/`.

Names that become file names (skill, batch, task id, seat, run id) are checked so none can point outside its folder. A skill name is lowercase letters, digits and `-`, up to 128 characters, and a batch name is the same. A task id or run id starts with a letter or digit, then letters, digits, `.`, `_` and `-`, up to 128 characters, with no `..`. The run id `ledger.jsonl` is not allowed, because `bench/out/ledger.jsonl` is the spend ledger. Two task ids in one task file (or in one batch of the exclusions file) that differ only in case, such as `T1` and `t1`, are refused with both ids named, because macOS and Windows file systems would give them one file. A seat name is lowercase letters, digits, `_` and `-`, starting with a letter or digit, up to 64 characters. It has no `.`: a judgment file is named `<task>.<seat>.<arm>.json`, and with no `.` in the seat, two different pairs of task and seat can never share a file. It has no capitals, because macOS and Windows file systems ignore case and seats `A` and `a` would overwrite each other's file. A seat name in `models.judges` that breaks these rules is refused with the setting named.

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

With `--json` the plan is one JSON object. `pending_usd` is the estimated cost (the mean) of the pending calls rounded to cents, and `pending_usd_unrounded` the same sum before rounding. `pending_usd_p90` is the upper estimate (the p90) rounded to cents, and `pending_usd_p90_unrounded` the same sum before rounding, which is what is compared with the limit. `worst_case_usd` is the upper estimate too, rounded to cents. Each stage has `usd` (mean) and `usd_p90`. `within_max` says whether the plan is within `max_usd` and is the field a script should read. `ok` is `true` when nothing refused the plan, which is exit code 0.

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

| Code | Meaning                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done.                                                                                                                                       |
| 1    | The plan is refused: an invalid baseline or agent spec, a projected cost above `max_usd`, or no selected skill that can be run.             |
| 64   | Usage error: a bad flag or value, an unknown skill, or a settings file that cannot be read.                                                 |
| 66   | A file or folder the plan needs is missing.                                                                                                 |
| 70   | Internal error: a bug in the benchmark. One line says so. `BENCH_DEBUG=1` adds the stack trace.                                             |
| 74   | I/O error reading a file or folder, such as permission denied. This includes a baseline, exclusions or agent spec file that cannot be read. |

Every failure except 70 prints an `error: <what> (<file>)` line to stderr and no stack trace. Bad JSON or a repeated key in a baseline or in `bench/exclusions.json` is not a crash: the file is listed as a problem and `plan` exits 1. Bad JSON or a repeated key in a settings file exits 64. A file that cannot be read at all (permission denied, a symlink loop, a folder in place of a file) is not bad JSON: it exits 74 for a baseline, exclusions, agent spec or `SKILL.md` file, and a file that vanishes while it is read exits 66. A baseline file that is not there is not an I/O error: it is listed as `file is missing` and the plan exits 1. The settings file is the exception: any problem reading it, including one of these, exits 64. A plan whose selected skills are all `no baseline` or `no agent` has nothing to run: `plan` exits 1 and prints one line under `Refused` that names each skill and its status. A selection that also holds a skill that can be run is not refused for that reason. `node scripts/bench/bench.js --help` lists the same codes.

## Settings and cost

Every command reads its settings from `bench/config.json`, which is git-ignored. To start one, run `cp bench/config.example.json bench/config.json` and then edit it. Without it, a command stops with a line that names the full path of the settings file it looked for and the `cp` command that makes it there. The committed `bench/config.example.json` holds every setting at its default, and the settings file must hold every setting too: a missing one is refused by name (`<setting>: missing; copy it from bench/config.example.json`), and so is a setting the example does not have. `--config <file>` reads another file instead, with the same rules. The limits must satisfy `max_usd <= total_cap_usd`. The old `stop_usd` and `hard_cap_usd` are refused with a message that names `total_cap_usd`, so a stale settings file cannot pass. The old `orders_per_pair` is refused too (`removed: each answer is scored on its own`), and so are the old `agent_for` (`removed: the agent comes from the agent specs`) and `needs_tools` (`removed: not in the MVP`).

| Setting                 | Default                                                                                                    | What it does                                                                                                                                                                                             | When to change it                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `models.subject`        | `claude-sonnet-5-5`                                                                                        | The model that answers the tasks, with and without the skill.                                                                                                                                            | To measure the skills on another model. Work made with the old model is stale.                             |
| `models.judges`         | `anthropic`: `us.anthropic.claude-opus-5-5`, `openai`: `us.openai.gpt-6.1-terra`, `xai`: `us.xai.grok-4.7` | The judge seats, seat name to model. A seat name is lowercase letters, digits, `_` and `-`.                                                                                                              | To add, drop or repin a judge. Work made with the old model is stale.                                      |
| `models.rubric_writer`  | `null`                                                                                                     | The model that writes the request-only checklists. `null` means the `anthropic` seat's model.                                                                                                            | To write the checklists with a model that is not a judge. Without an `anthropic` seat it must be set.      |
| `max_usd`               | `30`                                                                                                       | Spend limit of one run in USD. `--max-usd` overrides it for one command.                                                                                                                                 | To allow a bigger or smaller run. It cannot pass `total_cap_usd`.                                          |
| `total_cap_usd`         | `100`                                                                                                      | Spend limit of the ledger total across every run, in USD.                                                                                                                                                | When the whole budget changes.                                                                             |
| `confirm_above_usd`     | `5`                                                                                                        | A paid run whose estimate is at or above this many USD asks for confirmation first. `0` always asks.                                                                                                     | To be asked more or less often.                                                                            |
| `estimate_usd_per_call` | `subject` 0.078125, `judge` 0.0625, `writer` 0.01375                                                       | The fallback price, in USD per call, of a model the cost profile has no entry for: its mean, with a p90 of 1.5 times it. The writer figure is per request-only checklist. `plan` warns when it uses one. | When you add a model with no history. Lower figures let through a run that should be refused, so err high. |
| `aws_profile`           | `null`                                                                                                     | The AWS profile subject runs export credentials from. `null` uses the default credential chain.                                                                                                          | When your Bedrock access is under a named profile.                                                         |
| `aws_region`            | `us-west-2`                                                                                                | The AWS region of every model call.                                                                                                                                                                      | When your models are in another region.                                                                    |

The model IDs are pinned in the example. They were not re-checked against Bedrock when it was written. A change to one is a settings change in its own commit, and work made with the old ID is stale.

### Cost profile

`plan` prices each call from the cost profile `bench/profiles/cost-observed.json`: for each call kind (`subject`, `judge`, `writer`) and model, the `mean`, `median` and `p90` (90th percentile) cost of one call in earlier runs, with the number of `calls` and `failed` calls it was measured on. Its `provenance` says where the figures come from. The lookup for a call is the entry for its exact kind and model, then the kind's entry with model `"*"`, then `estimate_usd_per_call` for the kind as the mean, with 1.5 times that as the p90. A subject run is priced by `models.subject`, each judge seat by its own model, and a checklist call by the writer model (`models.rubric_writer`, else the `anthropic` seat's model). `plan` prints one warning that names every pending call kind and model priced at `estimate_usd_per_call`. A profile that breaks its rules (schema version 1, `unit` `"usd"`, a known kind, a model, finite amounts of 0 or more, `p90` at least the mean, no unknown entry field, no `cliReportsLow` on a `"*"` entry) stops `plan` with a usage error that names the file; there is no silent fallback. An entry with `cliReportsLow: true` is a model whose CLI reports less than the call costs.

The mean is the estimated cost; the p90 is the upper estimate, and it is the figure `plan` checks against `max_usd`, so a run is refused before it starts rather than stopped in the middle.

The profile projects about 9.71 USD (mean) and 16.68 USD (p90) for one skill read over two batches of 8 tasks with the 3 default judge seats. Per batch, as mean and p90: paired runs 1.07 and 1.94 (16 runs), judging 1.79 and 3.05 for each reading (48 calls: each seat judges each of the 2 answers on its own) and checklist writing 0.21 and 0.30 (8 calls).

`plan` prices the calls that are still pending and refuses the plan if the p90 total is above `max_usd`. A plan whose p90 is exactly `max_usd` is allowed. Amounts are written to cents, with more decimals when two different amounts would otherwise read the same, or when a limit above 0 would read as $0.00. The per-call costs were measured on earlier runs and can differ on this one, so `plan` advises a budget of about $35 per skill. The $35 is about twice the one-skill p90, rounded up to a multiple of 5: a margin and not a second estimate.

## Not built yet

These are added in a later PR: the commands that run the tasks and the judges, the checklist writer for reading A, scoring, and the report.
