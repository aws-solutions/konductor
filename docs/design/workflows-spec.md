<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflows: specification

The exact rules for the workflow file, stage prompts, diagnostics and commands. [workflows.md](workflows.md) holds the
design and the decisions (D1 and up) behind these rules. It also defines the [terms](workflows.md#terms) used here.
[workflows-plan.md](workflows-plan.md) says which slice adds what. Exports to Kiro CLI and Claude Code are
[slice 14](workflows-exports.md), not part of the first release. **Status:** Proposed, with the design.

## Where workflows live

A workflow is `<name>.yml` in one of three places:

- Project: `<repo>/.konductor/workflows/<name>.yml`.
- User: `~/.konductor/workflows/<name>.yml`.
- Shipped: built into the binary, not a folder on disk, and named `library/<name>`. `library/` is a lookup prefix, not a
  directory.

A bare name resolves to the project file, then the user file, then the shipped workflow (D5). `library/<name>` always
names the shipped one. A shipped workflow ported from an SOP is named `library/<sop-name>`, where `<sop-name>` is the
SOP's file name without `.sop.md`. The SOP `k-adversarial-pull-request-review.sop.md` becomes
`library/k-adversarial-pull-request-review`, and the name fits the name pattern under [Rules for every
file](#rules-for-every-file). A port whose SOP file name does not fit that pattern, for example because it has an
underscore or runs past 64 characters, is named by the port's author, who records the chosen name in the plan. `name`
defaults to the file name without `.yml` and must equal it when present (`NAME_MISMATCH`, D2).

## Rules for every file

- YAML 1.2 core schema, exactly one document. Only `true` and `false` are booleans. Anchors, aliases, merge keys, tags,
  a second document and non-scalar keys are `YAML_UNSUPPORTED`. The root and every stage must be mappings
  (`NOT_A_MAPPING`). A key twice in one mapping is `DUPLICATE_KEY`, never "last one wins". A key that no slice plans is
  `UNKNOWN_KEY`.
- A path is relative to the project root and uses `/`. It is not absolute and has no `..`. The exception is
  `prompt_file`, which is relative to the workflow file's folder. A path never leaves its folder or follows a symlink
  out of it. The engine reads a file only if it is a regular UTF-8 file with the expected name, within the size limit.
  Anything else, such as a link or directory, is treated as not there, and nothing is read or written through it. A path
  that breaks these rules in `intent.accept[].file`, a `stages[].outputs` value or `prompt_file` is `INVALID_VALUE`.
- One name pattern, `^[a-z0-9][a-z0-9-]{0,63}$`, applies to workflow names, stage names, check ids and agent ids
  (`INVALID_NAME`). Output names use `^[a-z][a-z0-9-]{0,63}$`. They start with a letter so that a reference can name
  them and numbers like `{1.5}` stay literal text (`INVALID_NAME`). Param names use `^[a-z][a-z0-9_]{0,63}$`
  (`INVALID_NAME`), so names such as `diff_input`, `pr_url` and `output_file` fit.
- A missing `format` is `MISSING_KEY` (suggestion `format: konductor/1`). Any value but `konductor/1` is
  `UNSUPPORTED_FORMAT`. `version: '1.1'` is `INVALID_VALUE` (suggestion `0.1.0`).
- Lengths count Unicode code points, but the file limit is in bytes. The engine checks limits before it uses the
  content. A file over 262144 bytes (256 KiB) is treated as not there. Goal text over 2048 characters is a usage error.
  A value outside a limit in [Keys](#keys) is `INVALID_VALUE`. YAML nested deeper than 32 levels is `YAML_UNSUPPORTED`.
- A message never quotes a value that looks like a secret.

## Keys

| Key                    | Type                                  | Required               | Default       | Slice |
| ---------------------- | ------------------------------------- | ---------------------- | ------------- | ----- |
| `format`               | `konductor/1`                         | yes                    |               | 1     |
| `name`                 | name pattern                          | no                     | file stem     | 1     |
| `version`              | semver `X.Y.Z`                        | yes                    |               | 1     |
| `intent`               | mapping                               | yes                    |               | 1     |
| `intent.outcome`       | string, one line, 1 to 300 characters | yes                    |               | 1     |
| `intent.accept`        | list of check                         | no                     | `[]`          | 1     |
| `intent.accept[].id`   | name pattern, unique in the file      | yes                    |               | 1     |
| `intent.accept[].file` | path                                  | one of                 |               | 1     |
| `intent.accept[].run`  | list of string (argv)                 | one of                 |               | 3a    |
| `params`               | map of name to param                  | no                     | `{}`          | 1     |
| `params.goal`          | mapping: `description?`, `default?`   | no                     | see below     | 1     |
| `params.<name>`        | mapping (see below)                   | no                     |               | 2     |
| `stages`               | list of stage, 1 to 40                | yes                    |               | 1     |
| `stages[].name`        | name pattern, not reserved            | yes                    |               | 1     |
| `stages[].agent`       | name pattern                          | yes, in an agent stage |               | 1     |
| `stages[].prompt`      | string, 1 to 32768 characters         | no                     | fallback line | 1     |
| `stages[].prompt_file` | path; text 1 to 32768 characters      | no                     | absent        | 1     |
| `stages[].outputs`     | map of name to path                   | no                     | `{}`          | 2     |
| `stages[].done_when`   | list of check id                      | no                     | `[]`          | 3a    |

Keys of later slices are reserved (D3). A build that does not know a key or check kind reports
`NOT_SUPPORTED_BY_THIS_BUILD` and names the slice. [Reserved keys](#reserved-keys) lists them, and
[Planned keys](#planned-keys-slice-13) describes the slice 13 keys. A released key never changes meaning (D20). Every
key belongs to exactly one slice, and a test checks it ([plan](workflows-plan.md#rules-for-every-slice)). A slice
that ships in lettered steps tags a key with the step (`3a`).

- **`intent`** is a mapping with `outcome`. The string form is planned, not supported.
- **`intent.accept`** lists the checks that decide whether the workflow met its intent. A check has an `id` (a separate
  namespace from stage names) and exactly one of `file: <path>` or `run: [argv]` (the kinds are in
  [Terms](workflows.md#terms)). A `run` check is a list of strings, run directly with no shell, in the project root.
  Anything else is `INVALID_VALUE`.
- **`done_when`** lists check ids from `intent.accept`. A stage passes only when its `done_when` checks pass and it has
  [evidence](workflows.md#terms). An id that is not a check in `intent.accept` is `INVALID_VALUE`, at the entry.
- **`params`** are named inputs of a run, and every value is a string. `params.goal` is always the run's goal text,
  declared or not. With no default, a run without `--goal` is a usage error. `params.<name>` has `type` (`string`, the
  default) and may have `description`, `default` and `required`. Other types are planned, not supported.
- **Stage kind.** A stage has exactly one stage-kind key (`STAGE_KIND_MISSING`, `STAGE_KIND_AMBIGUOUS`). This release
  knows one, `agent`, which names an installed Konductor agent and is required in that kind. A stage with no stage-kind
  key, including one with no `agent`, is `STAGE_KIND_MISSING`, not `MISSING_KEY`. `flow check` does not require the
  agent to be installed; `flow run` does. A stage `name` is unique (`DUPLICATE_STAGE`), and `start`,
  `end`, `run` and `halt` are reserved (`RESERVED_NAME`) as canvas graph markers.
- **`outputs`** maps an output name to a file the stage must leave behind, as in `outputs: { design: DESIGN.md }`. The
  name follows the output name pattern and is unique in the stage (`DUPLICATE_KEY` otherwise). The value is a path that
  follows the path rules. The map keeps its declared order. The [stage prompt](#stage-prompts) names the paths. Only the
  runner checks them on disk. A later slice may accept a mapping as the value ([Planned forms](#planned-forms)).
- **Model.** A stage has no `model` key in this release. It uses its agent's model (D11), from the installed agent file
  or definition.

## Stage prompts

`prompt` (inline text) or `prompt_file` (a Markdown file) says what a stage does.

- At most one is set; both is `INVALID_VALUE` at the `prompt_file` value. With neither, the stage uses the fallback line
  below. A project workflow reads `prompt_file` only from `.konductor/workflows/` (the [trust hash](#trust) covers
  it), a user workflow only from its own folder, and a shipped workflow embeds its prompt files. A missing file, or one
  that breaks the file rules, is `INVALID_VALUE` at the `prompt_file` value.
- **Template references.** The reference pattern is `\{[a-z0-9][a-z0-9-]*\.[a-z_][a-z0-9_-]*\}`, as in `{run.goal}` or
  `{plan.design}`. Any other `{` or `}` is literal, so a JSON shape such as `{severity, file, line}` is fine. Slice 2
  fills in `{run.param}` and `{stage.output}` before `stage_prompt` runs. `{stage.output}` renders as the output's
  relative path, not the file's content, so text that an earlier stage wrote stays out of the prompt body. A stage that
  needs the content reads the file. A reference may name an output of the same stage or of an earlier stage. A reference
  to an output that the named stage does not declare, or to an output of a later stage, is `INVALID_VALUE` at load time,
  at the reference. Slice 2 also defines the escape for literal text that matches the pattern
  ([deferred](#deferred-to-a-later-slice)). Until that escape exists, a build rejects such text with
  `NOT_SUPPORTED_BY_THIS_BUILD`, so an accepted file keeps its meaning. The engine parses templates once at load and
  never substitutes them by regex scanning.
- **Exports.** The rule for `{{` in a Kiro export (D17) is in [the exports
  note](workflows-exports.md#stage-prompts-in-an-export).

`stage_prompt` (D10) is a pure function in the engine's core, and nothing else builds a stage prompt. It takes the goal
text, `intent.outcome`, the ordered stages and the current stage. Line ends become
`\n` and surrounding whitespace is trimmed. The output is the lines below joined with `\n`, with no final newline. Angle
brackets mark what is replaced.

```text
Goal: <goal>
Workflow outcome: <outcome>

You are stage <N> of <M>: <name>.
Earlier stages: <earlier>.
Later stages: <later>.
Anything earlier stages produced is in the workspace files.
All file paths are relative to the project root.
Files this stage must write: <outputs>.

<authored>
```

- `<N>` counts from 1 and `<M>` is the number of stages. `<earlier>` and `<later>` list the stages before and after, in
  workflow order, as `name (agent-id)` separated by `, `, or `none`.
- The line `Files this stage must write: <outputs>.` is slice 2 (it comes with `outputs`). The function emits it only
  when the stage declares `outputs`. `<outputs>` is the output paths in declared order, separated by `, `. A stage with
  no `outputs` gets the preamble without the line, byte for byte. The golden tests cover both forms.
- `<authored>` is the trimmed authored prompt, or with none the fallback line
  `Do the part of this work that fits your role.`

The runner adds its ending after a blank line and must not change the shared text. The ending is the
[stage result](#stage-result) block. Golden tests for the function and the runner use the same text. A later export
adds its own ending the same way ([exports](workflows-exports.md#stage-prompts-in-an-export)).

## Stage result

The runner reads a stage's result from the session's final message, so an agent with no write tool can return one (D8).
After the shared text and a blank line, the runner adds this fixed ending. It is literal text with nothing to replace,
and `PLAN.md` is an example. Golden tests keep it byte-exact, like the preamble:

```text
End your final message with one line, and put nothing after it:
KONDUCTOR_RESULT {"status": "success", "outputs": ["PLAN.md"]}
Use "failure" as the status if you could not do the work. List each file you wrote in "outputs", or use [].
```

- **Where the runner reads it.** The final message is the stdout of `kiro-cli chat --no-interactive` and the `result`
  field of `claude -p --output-format json` ([Sources](workflows.md#sources)). The runner takes the last line that
  starts with `KONDUCTOR_RESULT `, so an example quoted earlier in the message does not count.
- **Shape.** The rest of that line is one JSON object. `status` is `success` or `failure`, and `outputs` is a list of
  paths, not names, that follow the [path rules](#rules-for-every-file). Other keys are ignored.
- **Invalid or missing.** The stage is `blocked`, and the run state records the reason, when:
  - the line is missing (`RESULT_MISSING`);
  - its JSON is invalid, a field is missing or has the wrong type, or an `outputs` path breaks the [path
    rules](#rules-for-every-file) (`RESULT_INVALID`);
  - `status` is `failure` (`RESULT_FAILURE`);
  - the session exits with a non-zero status (`SESSION_FAILED`);
  - the stage or one of its checks exceeds its time limit (`TIMEOUT`, see [Limits](#limits)).
- **Then the evidence.** Before a stage starts, the runner records the state of each declared output: absent, or its
  size, modification time and content hash. After the stage it checks each declared output path on disk. An output
  passes only if it was absent before and exists now, or its modification time or content differs from before. A
  declared output that is absent is `OUTPUT_MISSING`. An output that existed before and is unchanged is
  `OUTPUT_UNCHANGED`. This catches a stale or committed file, not a forged touch. The runner then runs the `done_when`
  checks. A failed check is `CHECK_FAILED`. The reported `outputs` go into the run state and are not proof. Checks in
  `intent.accept` test the workspace as it is and have no freshness rule.

## Harness invocation

How the runner starts each runner harness. The conformance check re-tests these ([Sources](workflows.md#sources)).

- **Kiro CLI (`kiro-cli`).** `kiro-cli chat --no-interactive --agent <agent-id> "<prompt>"` plus an engine flag. Kiro
  CLI has the engine values `v1`, `v2` and `v3` (`--agent-engine`), and this design uses two. The runner passes `--v2`
  with a `kiro-cli-v2` agent file and `--v3` with a `kiro-v3` file (D16). A `kiro-v3` file under `--v2` exits 4 with
  `Mode '<name>' not found`.
- **Kiro permissions.** On V3 the runner passes `--trust-tools=<ids>`: the exact ids of the tools in the agent's own
  allow list, found with a map from the agent's tools to ids, so the flag grants nothing beyond that list. On V2 that
  flag had no effect for any tool-name form tried, so the agent file's `allowedTools` applies and the conformance check
  re-tests the flag. The runner never passes `--trust-all-tools` (D19).
- **Claude Code (`claude`).** `claude -p --output-format json "<prompt>"`, with the stage's final message in `result`.
  The runner passes no allow rules and no permission mode, so a call that needs approval is denied.
- **Versions.** The runner checks ran on a Kiro CLI 2.34 pre-release build. Before release, the conformance check (real
  runs of both tools) repeats them on a public release and pins a minimum version of each tool, which
  `konductor doctor` enforces.

What a native export needs is in [the exports note](workflows-exports.md#harness-invocation-for-exports).

### Limits

These are fixed in the first release. A per-run override can be added later without changing a released key (D20).

- **Time.** A stage may run for 30 minutes of wall-clock time, and a check for 10 minutes. On expiry the runner sends a
  terminate signal to the whole process group, waits 10 seconds, then kills it. The stage is `blocked` with the reason
  `TIMEOUT`.
- **Output.** The runner keeps the last 1 MiB of a harness session's stdout, because the result line is the last line of
  the final message. It keeps the last 256 KiB of a check's output.
- **Params.** Each param other than `goal` is at most 64 KiB, and a rendered stage prompt is at most 100 KiB. A longer
  value or prompt is a usage error (exit 64). Step 1f checks the host's command-line argument limit against this.
- **Budgets.** A cap on cost or tokens waits for slice 12.

## Saving a file

`base_hash` is the SHA-256 of the file's raw bytes as 64 lower-case hex digits. A mismatch refuses the write, and `null`
means the file must not exist yet (D12). The writer stores the text exactly as sent: it adds or removes no byte order
mark, changes no line ending and adds no final newline.

Anything that rewrites a workflow keeps every key it does not edit. Those keys keep their values and order. A writer
replaces only the bytes of the values it edits, and every other byte stays identical, comments included. The span of an
edited value runs from its first byte to its last, and a comment inside that span may be lost. Each editor has a
round-trip test with two parts. A save with no edit returns the input byte for byte, for a file holding every key. A
save that edits one value changes no byte outside that value's span, in a file with comments before, after and inside
keys. A key is added to the engine and the canvas in one change with such a test (D13).

## Trust

A project workflow runs only after the user confirms it, once per workflow (D14). User and shipped workflows need no
trust, unless the repo carries tool configuration files (see below). Content that comes from the Konductor binary is not
a trust question. Content written by a model or taken from a repository is not trusted until the user confirms it. No
setting turns trust off.

**What the trust hash covers.** The trust hash is a SHA-256 over the bytes of the workflow file and the bytes of every
`prompt_file` it names, in a fixed order. Later slices add the workflows a workflow reaches. The loader hashes the same
bytes it parses, so a file edited after the confirmation cannot run. A change to another workflow in the repo does not
change this workflow's hash. The hash pins the command line of each `run` check, not the code it runs. The byte layout
is [deferred](#deferred-to-a-later-slice).

**Repo tool configuration.** A headless run loads some repo files with no tool prompt: `.claude/settings.json`,
`.mcp.json`, agent files under `.kiro/agents/` and agent files under `.claude/agents/`. When the repo root contains any
of these, a run of any workflow, project, user or shipped, needs confirmation, and the hash also covers those files. The
summary lists them. A user or shipped workflow then has a record keyed by the repo root and its name, like a project
workflow. Files that Konductor's install manifest records and that are unchanged since the install are not counted, so a
project install does not ask on every run.

**The record.** Trust is recorded in `~/.konductor/trust.json`, in the user's home directory and outside every
repository, with file mode 0600. A clone cannot ship a record. Each entry is keyed by the canonical repository root and
the workflow name, and holds the trust hash the user confirmed. The file is global on purpose, so that a record cannot
come from a clone. The runner writes it to a temporary file in the same directory and renames it, under an advisory
lock, so two writers do not lose an update. A record that cannot be read or parsed counts as "nothing trusted".

**Asking.** `flow run` and `flow verify <run-id>` on a workflow that needs confirmation show a summary and ask once,
"Trust this workflow and run it? y/N". On yes, the command records trust and continues. On no, it exits 77 without
running anything. The summary lists:

- the workflow name and path;
- its trust hash;
- each agent id, with the runner harness it will use and the tools its allow list permits;
- each `run` check command (argv), with a note when its program is a path into the repo;
- each file the hash covers.

Later slices extend this list as they add commands, connections and reached workflows.

**At `flow view`.** `flow view <name>` on a workflow that needs confirmation, with a terminal, shows the same summary
and asks the same question before it starts the server. On yes, it records trust. On no, or without a terminal, the
canvas still opens, and a Run gets `trust_required`.

**Without a terminal.** A workflow that needs confirmation exits 77 and names the two ways to proceed:
`konductor flow trust <name>`, or `--trust <hash>` on the command, also settable as `KONDUCTOR_TRUST=<hash>`. A
`--trust` hash applies only when it equals the current hash of the workflow being run (for `flow verify`, the run's
workflow), and it permits that command only. A
mismatch exits 77 and prints both hashes. `flow check` prints the trust hash of the file it checked, in a `trust_hash`
field of `--json`.

**Explicit form.** `flow trust <name>` shows the same summary and asks for confirmation unless `--yes` is given.
`flow trust --revoke <name>` removes the record. `flow trust <name>` on a user or shipped workflow in a repo without
tool configuration files prints that no trust is needed, exits 0 and writes no record.

**Canvas.** The canvas never grants trust. A canvas save of workflow X keeps trust only if X was trusted and matched its
record, and the save adds no `run` argv and changes no stage `agent`. The canvas server then writes the file and moves
X's record to the new hash. Otherwise it writes the file and leaves the record as it is, and the next Run gets
`trust_required` ([Threats](workflows.md#threats)). Edits to prompts, params, stage order and outputs keep trust,
because the agent's allow list still bounds what a prompt can do.

The hash does not cover agent definitions. A repo file that could replace an installed agent definition is part of the
[deferred](#deferred-to-a-later-slice) trust coverage item.

## Diagnostics and codes

A code is upper snake case. A code is never renamed or reused (D4).
It says what happened, not which inputs trigger it, so a rule change keeps its code and a new case gets a new one.

These 12 codes, all errors, are shared with the canvas API contract, which must keep their names and meanings:
`YAML_SYNTAX`, `YAML_UNSUPPORTED`, `NOT_A_MAPPING`, `UNKNOWN_KEY`, `DUPLICATE_KEY`, `MISSING_KEY`, `WRONG_TYPE`,
`INVALID_NAME`, `RESERVED_NAME`, `DUPLICATE_STAGE`, `NAME_MISMATCH` and `INVALID_VALUE`. A non-semver `version`, both
prompt keys, a missing `prompt_file` and an unknown `done_when` id use `INVALID_VALUE`. This design adds these codes:

| Code                          | Severity | Raised when                                                                                            |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `UNSUPPORTED_FORMAT`          | error    | `format` is present and is not `konductor/1`                                                           |
| `STAGE_KIND_MISSING`          | error    | A stage has no stage-kind key                                                                          |
| `STAGE_KIND_AMBIGUOUS`        | error    | A stage has more than one stage-kind key                                                               |
| `NOT_SUPPORTED_BY_THIS_BUILD` | error    | A key, check kind, param type, `intent` string or template reference this build lacks; names the slice |

Every first-release code is an error and stops the command with exit 65. A later slice may add warnings, which are shown
and do not stop the command, and infos, which need no action. The export codes are in
[the exports note](workflows-exports.md#codes).

## Commands and exit codes

All commands are under `konductor flow`. A command marked as needing [trust](#trust) runs a project workflow only once
it is trusted: on a terminal it asks, and without one it exits 77. User and shipped workflows need no trust, unless the
repo carries tool configuration files. These are
the first-release rules until the runner's design decides ([deferred](#deferred-to-a-later-slice)).

| Command                                                                          | Purpose                                                      | Needs trust |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| `flow check <name>`                                                              | Validates the workflow                                       | no          |
| `flow show <name>`                                                               | Prints the resolved workflow as JSON, with prompt text       | no          |
| `flow run <name> --goal "..." [--param name=value] [--harness h] [--trust hash]` | Runs it with the runner (harness `h` below)                  | yes         |
| `flow verify <run-id> [--trust hash]`                                            | Runs the checks in `intent.accept` of the run's workflow     | yes         |
| `flow trust <name> [--yes]`                                                      | Shows the summary, asks, and records trust                   | no          |
| `flow trust --revoke <name>`                                                     | Removes the record of one workflow                           | no          |
| `flow view <name> [--harness h]`                                                 | Starts the canvas, asking first if the workflow is untrusted | no          |

`flow build` and `flow verify <name> --workspace` belong to [slice 14](workflows-exports.md#commands).

`--harness` takes `kiro-cli`, `claude` or `fake`. Without it, `flow run` and `flow view` use the one runner harness that
is installed: the install harnesses `kiro-cli-v2` and `kiro-v3` mean `kiro-cli`, and `claude` means `claude`. If both
runner harnesses are installed, or neither, `--harness` is required and leaving it out is a usage error (exit 64).
`fake` is for tests only and is never a default. The canvas session's `harness` field reports the chosen value.

`flow check` and `flow show` take `--json`. Their output is stable: keys sorted, no machine paths, byte-identical
whatever the YAML key order. The one exception is the `trust_hash` of `flow check`, which hashes the file's bytes.

Exit codes follow the CLI's exit-code contract in `cli/README.md`. A command that needs trust checks it first.

| Code | Meaning in the `flow` commands                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `0`  | Done. `flow check`: no errors. `flow run`: run `passed`. `flow verify`: `passed` or `unverified`                       |
| `1`  | `flow run`: run `halted`. `flow verify`: result `failed`                                                               |
| `64` | Usage error, in any command                                                                                            |
| `65` | The workflow has errors (`flow check`, `flow show`, `flow run`, `flow verify`)                                         |
| `77` | Trust refusal: the workflow is not trusted and the user said no, no terminal was available, or `--trust` did not match |

The CLI's contract defines `65` as an unsupported manifest or index `schema_version`, a state failure, and has no `77`.
Its `1` row reads "Halted (timeout / runtime error / parse error)", and `doctor` reuses it for a failed check. The
change that adds the commands edits `cli/README.md` in three places:

- widen the `65` row to cover workflow errors;
- add the `77` row;
- widen the `1` row to cover a `flow run` that halted and a `flow verify` that failed.

Every trust refusal exits `77`, including a no at the prompt, so a script handles one code. The `flow` commands never
emit `2`, which the CLI reserves, or `4`, which stays reserved for a user who aborts a paused verdict.

## Run, stage and check states

| Thing | States                                    | Rule                                                                                    |
| ----- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Run   | `running`, `passed`, `halted`             | A run that was `running` reads as `halted` on the next start only if its owner is gone. |
| Stage | `pending`, `running`, `passed`, `blocked` | A blocked stage halts the run, and later stages stay `pending`.                         |
| Check | `verified`, `deferred`                    | `verified`: Konductor ran it. `deferred`: not checked yet.                              |

`flow verify` runs every check in `intent.accept` and turns `deferred` into `verified` or a failure (D15). Its result is
separate from the check states. An export adds the state `reported`
([exports](workflows-exports.md#check-state-reported)).

| Result       | When                                                            | Exit |
| ------------ | --------------------------------------------------------------- | ---- |
| `passed`     | Every check is `verified`                                       | `0`  |
| `failed`     | A check fails                                                   | `1`  |
| `unverified` | Anything else, such as no checks declared (the message says so) | `0`  |

With no checks the result is never `passed`. A caller that needs proof must read the result, not the exit code.

## Requirements on the canvas API contract

`workflow-canvas/api/openapi.yaml` is the contract that the canvas, its stub and the real server implement. This design
needs the changes below.

- **File keys.** The workflow-text table lists `version`, `name`, `intent` and `stages` and no other keys, and a stage
  has `name` and `agent` only. It adds `format` (required, `konductor/1`) and every other key in [Keys](#keys).
  `version` changes from the optional string `'1.1'` to a required semver `X.Y.Z`, so `'1.1'` becomes `INVALID_VALUE`.
  The `MISSING_KEY` and `INVALID_VALUE` rows follow.
- **View schema.** `WorkflowView` and its `Intent` and `Stage` schemas carry only `name`, `intent` and `stages`, and a
  stage has `name` and `agent`. They gain the keys of [Keys](#keys) that the canvas shows (D13): `Intent` gains
  `accept`, `Stage` gains `prompt`, `prompt_file`, `outputs` and `done_when`, and `WorkflowView` gains `format`,
  `version` and `params`. The view still has the mapping form of `intent` only.
- **`intent`.** The table accepts one line or a mapping with `outcome`. This design accepts the mapping only (D18). The
  string form reports `NOT_SUPPORTED_BY_THIS_BUILD`, and the canvas writes the mapping.
- **Pass rule.** "How a run goes" says every stage is a `kiro-cli` session and that a stage is `passed` when its session
  ends with exit status 0. It changes to the [stage result](#stage-result) and evidence (D8).
- **Harness.** The `Harness` enum, `[kiro-cli]` in the base contract, gains `claude` and `fake` (tests only). It types
  the `harness` field of the session response and of a run, and the session reports the value that `flow view` chose.
  `harness_unavailable` (409, with `fix`) then covers `claude` as well as `kiro-cli`: the tool is not installed or not
  signed in. It also covers `fake` on a server that was not started for tests ([deferred](#deferred-to-a-later-slice)).
- **Run stages.** `RunStage` gains `reason`, present when the stage is `blocked`. It is a stable upper snake case code
  (D4): the reasons named under [Stage result](#stage-result) and [Limits](#limits).
- **One run per workspace.** `already_running` covers a run started by any process in the workspace, because a run holds
  a per-workspace lock with its owner's PID and start time. When the owner exits, its sessions and checks are killed
  with their process group.
- **Params.** The `params` object of `RunRequest` accepts the params the workflow declares, besides `goal` (slice 2).
- **Trust.** `trust_required` joins `ErrorCode`. `POST /api/run` answers it with 409 for a project workflow that is not
  trusted. Its `fix` text names the exact command, for example `konductor flow trust hello-plan`. The contract has no
  operation that grants trust. The 409 description lists it. In the contract's order of checks for that call,
  `trust_required` follows 422 `invalid_workflow` and comes before 409 `already_running`, so an untrusted file never
  reveals or touches run state. The order is 404, 422, `trust_required`, `already_running`, `harness_unavailable`.
- **Diagnostics.** A key of a later slice reports `NOT_SUPPORTED_BY_THIS_BUILD`, not `UNKNOWN_KEY`. `DiagnosticCode`
  gains the [codes this design adds](#diagnostics-and-codes), and the 12 shared names and meanings stay.
- **Evolution sentence.** The sentence "a later version only adds" is amended. This change makes `format` required,
  narrows `version` and drops the string form of `intent`, and none of those is an addition. The same change says
  whether `info.version` and `api_version` change.
- **Stub and tests.** The stub validator, its fixtures and the example texts in the contract change in the same change
  as the contract, so the stub never accepts or refuses a file that the contract does not.
- **Unchanged.** The base contract matches this design on these points:
  - the run and stage status words;
  - the limits: 262144 bytes of text, 40 stages, 300 characters of `outcome` and 2048 characters of goal;
  - the name pattern and saving with `base_hash`;
  - the loopback, launch code and token rules.

### Canvas server

The base contract holds these rules, and this design keeps them. The server binds to loopback only, starts a session
only with the launch code, and checks the session token on every call. The launch code is a one-time secret that
`flow view` prints and the browser sends to start a session. The session token is the secret the server returns for that
session, which the browser sends on every API call. The page renders text from the repo (prompts, `prompt_file`
contents, diagnostics) as plain text, under a strict content security policy.

## Slices

A slice is one unit of delivery, numbered 1 to 14. A step is a lettered part of a slice (1a, 3b) that is built, tested
and released on its own. A slice adds a capability through the format, runner and canvas, and each slice adds its own
canvas controls (D13). [The plan](workflows-plan.md) is the one place that says what each slice adds, what it needs and
how it is tested. This table only names them. Exports are slice 14, described in [the exports
note](workflows-exports.md).

| #   | Slice                                                                              | First release     |
| --- | ---------------------------------------------------------------------------------- | ----------------- |
| 1   | [Skeleton](workflows-plan.md#slice-1-skeleton)                                     | yes               |
| 2   | [Data between stages](workflows-plan.md#slice-2-data-between-stages)               | yes               |
| 3   | [Checks, then command stages](workflows-plan.md#slice-3-checks-and-command-stages) | 3a only           |
| 4   | [Loops](workflows-plan.md#slices-not-in-the-first-release)                         | no                |
| 5   | [Human gates](workflows-plan.md#slices-not-in-the-first-release)                   | no                |
| 6   | [Parallel stages](workflows-plan.md#slices-not-in-the-first-release)               | no                |
| 7   | [Reuse](workflows-plan.md#slices-not-in-the-first-release)                         | no                |
| 8   | [Layers and patches](workflows-plan.md#slices-not-in-the-first-release)            | no                |
| 9   | [Canvas patch editing](workflows-plan.md#slices-not-in-the-first-release)          | no                |
| 10  | [Customization in chat](workflows-plan.md#slices-not-in-the-first-release)         | no                |
| 11  | [SOP library](workflows-plan.md#slice-11a-sop-library-first-port)                  | 11a only          |
| 12  | [Runner-only features](workflows-plan.md#slices-not-in-the-first-release)          | no                |
| 13  | [Planned keys](#planned-keys-slice-13)                                             | not yet scheduled |
| 14  | [Exports](workflows-exports.md)                                                    | no                |

## Deferred to a later slice

Each item has a slice or a design that owns it, and a rule until then.

- **Escape for literal template-reference text.** Slice 2. Until then, text that matches the reference pattern is
  rejected with `NOT_SUPPORTED_BY_THIS_BUILD`.
- **Worktree isolation for runner stages.** Slice 12. Until then the runner never passes `--trust-all-tools` (D19).
- **The slice 8 keys.** `stages[].renamed_from` is the earlier name or names of a stage, so a patch to a shipped
  workflow still finds a renamed stage. `stages[].required` marks a stage that a patch layer may not remove, and only
  shipped and team layers honor it. Until slice 8, each reports `NOT_SUPPORTED_BY_THIS_BUILD` (see
  [Reserved keys](#reserved-keys)).
- **The slice 13 keys.** Slice 13, not yet scheduled. Until then each reports `NOT_SUPPORTED_BY_THIS_BUILD`
  ([Planned keys](#planned-keys-slice-13)).
- **Session-start warning for an untrusted workflow.** Owner: the trust work. It needs a channel the user can see in
  each tool (the stdout of a Claude `SessionStart` hook goes to the model, not the user), and it must not fire in runner
  stage sessions. Until then `flow run` and `flow verify` ask on a terminal and otherwise exit 77 ([Trust](#trust)).
- **Trust hash byte layout.** Owner: [step 1e](workflows-plan.md#1e-trust), which builds `flow trust`. It fixes the
  separators, path encoding, sort order and hex form of the hash, and the order of the files in it.
- **Session recovery in the canvas.** Owner: the canvas contract, after the first release. A reload or a second tab has
  no session, because the token is kept in memory and the launch code works once. Until then the 401 screen tells the
  user to restart `flow view`.
- **Path-typed params.** Slice 13. Until then a large input such as a diff is passed inline, within the size cap in
  [Limits](#limits).
- **Stage agents editing the trust record.** Owner: the runner's design. A stage agent with a broad write tool can edit
  `~/.konductor/trust.json`. Until then the Threats table records it as a residual risk.
- **Per-run limit overrides, a per-stage harness and an opt-in shared session.** Not scheduled. Each is added without
  changing a released key (D20). Until then the limits are fixed, a run uses one harness and every stage starts a fresh
  session.
- **How a test server accepts `fake`.** Owner: the task that changes the canvas stub and server for the contract. Until
  then the mechanism is not specified.
- **Trust coverage beyond workflow files.** Owner: the runner's design. Until then the trust hash covers
  the workflow file, its prompt files and the repo tool configuration files ([Trust](#trust)), and user and shipped
  workflows need none outside such repos
  ([Commands](#commands-and-exit-codes)). That design fixes:
  - any further files the trust hash covers beyond the workflow file, its prompt files and the repo tool configuration
    listed under Trust;

  - how the runner tells a file that Konductor installed from another repo file, and how trust is recorded again after
    an install changes them;
  - whether Claude's `--bare` flag, which skips hook and MCP server discovery, fits the runner;
  - whether the runner refuses a stage whose agent id is also defined by a file in the repo, so that the installed
    definition is the one that runs.

    It may also relax the first-release rule that a repo with tool configuration files needs confirmation, if `--bare`
    makes it unnecessary.

## Planned keys (slice 13)

These keys are planned and not yet part of the format. No first-release workflow uses them (D18). Each reports
`NOT_SUPPORTED_BY_THIS_BUILD` (D3), naming slice 13, until a slice adds it. Adding one later only adds (D20). The slice
that adds a key also adds its canvas control (D13).

| Key                                                | Planned shape                                                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stages[].effort`                                  | `low`, `medium` or `high`; optional; absent by default.                                                                                                                                              |
| `stages[].model`                                   | `fast` or `frontier`; optional; absent by default. It overrides, for that stage, the agent's model that D11 sets, and D18 defers it. One table maps each tier to a model id for each runner harness. |
| `params.<name>.type`: `integer`, `boolean`, `path` | The `type` key takes these values besides `string`. The type decides how a value is checked and how a template renders it.                                                                           |
| `intent` as a string                               | `intent: <text>` means `intent: {outcome: <text>}`. A tool that rewrites the file keeps the form the author used.                                                                                    |

### Planned forms

These are new shapes for released keys, not yet scheduled. Each is added without changing the meaning of any released
key, so a file written today keeps its meaning (D20). A build that lacks one reports an existing code: `WRONG_TYPE` for
a mapping where `outputs` expects a path, a string where `run` expects a list, and a list where `params` expects a map,
and `UNKNOWN_KEY` for `description`. The message may say the form is planned. They are not in the Keys table or the
reserved keys.

| Form                                   | Planned shape                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stages[].outputs.<name>` as a mapping | `{ path, type }`, with the string as shorthand for `{ path }`. The string keeps its meaning. Added without changing the meaning of any released key.      |
| `intent.accept[].run` as a string      | A string that is split into argv by a fixed rule, with no shell, beside the list form. The list stays valid. Added without changing any released meaning. |
| `params` as a list of names            | `params: [a, b]` means each name is a string param with nothing else set, beside the map form. The map stays valid. Added without changing any meaning.   |
| `description` on a workflow            | An optional one-line label shown where workflows are listed. Added without changing the meaning of any released key.                                      |

## Reserved keys

These keys and stage kinds belong to later slices (D3). A build that does not know one reports
`NOT_SUPPORTED_BY_THIS_BUILD` and names the slice. Each is written as its key path:

| Slice | Keys and stage kinds                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3b    | `intent.writes`; the stage kind `stages[].run`                                                                                                             |
| 4     | `stages[].on_fail`, `stages[].max_iterations`, `stages[].on_exhausted`                                                                                     |
| 5     | the stage kinds `stages[].human_review` and `stages[].human_input`                                                                                         |
| 6     | `stages[].parallel`                                                                                                                                        |
| 7     | the stage kind `stages[].uses`                                                                                                                             |
| 8     | `stages[].renamed_from`, `stages[].required`                                                                                                               |
| 11b   | `fallback_sop`                                                                                                                                             |
| 12    | `runner_options`                                                                                                                                           |
| 13    | `stages[].effort`, `stages[].model`, the `integer`, `boolean` and `path` param types, the string form of `intent` ([Planned keys](#planned-keys-slice-13)) |
| 14    | `targets` ([exports](workflows-exports.md#the-targets-key))                                                                                                |

Once its slice lands, a key behaves as follows:

- `intent.writes` lists the paths the workflow may create or change. A path that breaks the path rules is
  `INVALID_VALUE`. A run that changes other tracked paths is reported with a warning whose code slice 3b adds (D4). That
  is the first warning code, so 3b also decides whether a run with a warning exits 0 or 6, the CLI's "success with
  warnings".
- `fallback_sop` names an existing SOP to use on a harness that has no workflows. A name that matches no SOP is
  `INVALID_VALUE`.
- `runner_options` holds features only the runner supports, such as a budget and worktree isolation.
- Slice 12 also adds conditions and per-item stages. It names their keys, and until it does they are `UNKNOWN_KEY` (see
  [Rules for every file](#rules-for-every-file)).
