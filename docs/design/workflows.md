<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflows: design

Code and tests build against this note, the [specification](workflows-spec.md) and the [plan](workflows-plan.md).
Exports to Kiro CLI and Claude Code are [slice 14](workflows-exports.md), not part of the first release. A decision
changes here, in the same pull request as the change that needs it.

## Problem

A Konductor SOP (standard operating procedure) is a Markdown procedure that an agent follows from the chat. Konductor
installs each SOP once for both Kiro CLI and Claude Code, so authoring is shared, but checking is not. Nothing confirms
that the agent ran a step, ran the steps in order, or produced what a step promised. An agent can skip or reorder a
step, or report a step done that it never did, and the user finds out by reading the chat. In a live check, a headless
Kiro CLI session had its only tool call denied. It exited 0, and the agent wrote in prose that it could not create the
file. Anything that trusted the exit status would have marked the step done.

## Goals and non-goals

Goals:

- Write a process once and run it in Konductor, on Kiro CLI or Claude Code. Exporting it to their native formats is
  [later](workflows-exports.md).
- Pass a step only on proof that Konductor checks itself, never on the agent's say-so.
- Run no project workflow, none of the commands it names, and no workflow in a repo that carries tool settings, until
  the user confirms it.

Non-goals: replacing SOPs, mixing tools inside one workflow, reading the visual editor's earlier file format, and
keeping Kiro CLI and Claude Code from loading a repo's own tool settings. The runner asks before it runs with them
present.

## Summary

A workflow file makes the order of a process and the proof of each step explicit. It is a YAML file that names an
outcome and lists, in order, the stages that reach it and the checks (tests of the outcome) that `konductor flow verify`
runs. Each stage hands work to one Konductor agent. Konductor runs the file with its own program, the runner. The
canvas, the visual editor, edits the file through the engine, the Rust code that checks files and builds stage prompts.

How a workflow file reaches a run. The trust check applies to project workflows:

```mermaid
flowchart LR
    canvas["Canvas: visual editor"] <--> engine["Engine: checks the file, writes the stage prompts"]
    engine <--> file["Workflow file: YAML"]
    engine --> gate{"Trust check: did the user confirm this workflow?"}
    gate -- yes --> runner["Run: one session per stage"]
    runner --> verify["Verify: run the checks"]
```

## Decision requested

Approve this note, with the specification and the plan, as the contract for building workflows, so that the three
goals above hold. Approving also approves the [decisions](#decisions) below.

The first release lets a user run the review workflow ported from the `k-adversarial-pull-request-review` SOP end to
end. The SOP runs its review passes in parallel, and the port runs them in sequence until slice 6 (a numbered unit of
delivery) adds parallel stages ([First release](#first-release); [all 14 slices](workflows-spec.md#slices)).

## Example

`workflow-engine/examples/hello-plan.yml`, abridged (no prompts or `params`). On an installed runner harness,
`konductor flow run hello-plan --goal "..."` runs both stages, then `flow verify` passes if `PLAN.md` exists:

```yaml
format: konductor/1
name: hello-plan
version: 0.1.0
intent:
  outcome: A short plan for the goal is written to PLAN.md, and the first step of it is done.
  accept: [{ id: plan-exists, file: PLAN.md }]
stages:
  - { name: plan, agent: k-architect }
  - { name: implement, agent: k-developer }
```

## Terms

- **Stage**: one step of a workflow, with a stable `name`. An **agent stage** hands work to one installed Konductor
  agent. The **runner** starts one fresh session per agent stage (D21).
- **Check**: a test of the outcome in `intent.accept`. A `file` check passes when the file exists and a `run` check when
  a program exits 0. A stage can require some with `done_when`, and `flow verify` runs them.
- **Evidence** of a stage: a valid [stage result](workflows-spec.md#stage-result) from the session and every output the
  stage declares, created or changed during the stage. An exit status of 0 is never evidence (D8).
- **Harness**: a **runner harness** is the program the runner starts for an agent stage: `kiro-cli`, `claude` or `fake`
  (tests only), the values of `flow run --harness`. An **install harness** is an agent file format that
  `konductor install --harness` installs: `kiro-cli-v2`, `kiro-v3` or `claude`. Neither appears in a workflow file.
- **Engine**: the Rust workspace in `workflow-engine/` that checks files and builds stage prompts.

## Decisions

| Id  | Decision                                                                                    | Where                                                          |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D1  | One YAML file per workflow, with an ordered list of stages                                  | [Keys](workflows-spec.md#keys)                                 |
| D2  | The workflow name is the file name                                                          | [Where workflows live](workflows-spec.md#where-workflows-live) |
| D3  | Keys of later slices are reserved                                                           | [Reserved keys](workflows-spec.md#reserved-keys)               |
| D4  | Diagnostic codes are public API                                                             | [Diagnostics](workflows-spec.md#diagnostics-and-codes)         |
| D5  | Lookup is nearest-first                                                                     | [Where workflows live](workflows-spec.md#where-workflows-live) |
| D6  | Shipped workflows are built into the binary                                                 | [Where workflows live](workflows-spec.md#where-workflows-live) |
| D7  | The engine is a Rust workspace under `workflow-engine/`                                     | [Terms](#terms)                                                |
| D8  | A stage passes on evidence, not on exit status                                              | [Stage result](workflows-spec.md#stage-result)                 |
| D9  | Runner harness and install harness stay separate                                            | [Terms](#terms)                                                |
| D10 | One function builds every agent stage's prompt                                              | [Stage prompts](workflows-spec.md#stage-prompts)               |
| D11 | A stage uses its agent's model                                                              | [Keys](workflows-spec.md#keys)                                 |
| D12 | A save writes the whole file with `base_hash`                                               | [Saving a file](workflows-spec.md#saving-a-file)               |
| D13 | The canvas keeps up with the format, through one validator                                  | [Editing and the canvas](#editing-and-the-canvas)              |
| D14 | Project workflows run only after the user confirms them, once per workflow                  | [Trust](#trust)                                                |
| D15 | The runner checks during the run                                                            | [Commands](workflows-spec.md#commands-and-exit-codes)          |
| D16 | The runner supports Kiro V2 and V3 and sets the engine flag                                 | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D17 | The Kiro export rejects `{{` in prompt text (slice 14)                                      | [Exports](workflows-exports.md#decisions-for-exports)          |
| D18 | `effort`, typed params, the string form of `intent` and per-stage `model` wait for slice 13 | [Planned keys](workflows-spec.md#planned-keys-slice-13)        |
| D19 | The runner grants no tool access of its own                                                 | [Runner](#runner)                                              |
| D20 | The format only grows                                                                       | [Keys](workflows-spec.md#keys)                                 |
| D21 | A fresh headless session per agent stage                                                    | [Runner](#runner)                                              |
| D22 | One OS file lock per workspace says whether a run is alive                                  | [Run states](workflows-spec.md#run-stage-and-check-states)     |
| D23 | Trust is confirmed by typing the first 8 characters of the hash                             | [Trust](workflows-spec.md#trust)                               |
| D24 | A new run ends the sessions that a killed owner left behind                                 | [Run states](workflows-spec.md#run-stage-and-check-states)     |
| D25 | The project root search stops at the git top folder                                         | [Commands](workflows-spec.md#commands-and-exit-codes)          |
| D26 | `flow check` prints no trust hash when the tool configuration cannot be read                | [Trust](workflows-spec.md#trust)                               |
| D27 | Kiro finds an agent in its working directory, then the home folder (see D42)                | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D28 | A V3 agent file under `--v2` is not refused                                                 | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D29 | The `doctor` pin for `kiro-cli` is 3.3.0                                                    | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D30 | How `--trust-tools` behaves on each Kiro engine (superseded by D43)                         | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D31 | How the `tools` list of a Claude agent file is read                                         | [Trust](workflows-spec.md#trust)                               |
| D32 | How the Claude agent for a stage is found, by its `name` field                              | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D33 | The trust summary shows the front matter keys of a Claude agent file                        | [Trust](workflows-spec.md#trust)                               |
| D34 | The `doctor` pin for `claude` is 2.1.323, and the runner does not use `--bare`              | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D35 | An empty `tools` list pre-approves nothing, and a space or a quote makes it Unknown         | [Trust](workflows-spec.md#trust)                               |
| D36 | A reader that halts a dead owner's run ends its sessions first                              | [Run states](workflows-spec.md#run-stage-and-check-states)     |
| D37 | `flow view` refuses a name that does not resolve to a file                                  | [Commands](workflows-spec.md#commands-and-exit-codes)          |
| D38 | A Claude agent file may hold column-0 lists under `tools`, `skills` and `mcpServers`        | [Trust](workflows-spec.md#trust)                               |
| D39 | The Designer edits a stage `prompt` with a parser-based value writer (step 1b-2)            | [Saving a file](workflows-spec.md#saving-a-file)               |
| D40 | The Designer refuses a prompt edit in a file with a lone CR anywhere or mixed line endings  | [Saving a file](workflows-spec.md#saving-a-file)               |
| D41 | A block scalar at the end of a file gets a final newline inside the value                   | [Saving a file](workflows-spec.md#saving-a-file)               |
| D42 | Kiro: the trust summary, the hash scan and the harness use one catalog                      | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D43 | The runner passes no `--trust-tools`, and the agent file is the one source                  | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D44 | Claude: the trust summary, the ambiguity check and the hash scan use the Claude catalog     | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D45 | An ACP harness is an optional step, 1f-3, behind the Harness trait                          | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D46 | Over ACP, permission requests are answered from the agent file's own allow rules            | [Harness invocation](workflows-spec.md#harness-invocation)     |
| D47 | 1g builds the contract it was cut for, and a follow-up step catches up                      | [1g-2](workflows-plan.md#1g-2-agent-list-fields-and-history)   |
| D48 | 1g adds each stage's kind and range, and 1g-2 adds the three session fields                 | [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view) |
| D49 | A session group is on record at spawn, and the owner ends it when a signal arrives          | [Run states](workflows-spec.md#run-stage-and-check-states)     |
| D50 | The runner shows a 4 KiB tail of a session's stderr on the terminal only                    | [Limits](workflows-spec.md#limits)                             |
| D51 | A session's deadline holds without its owner, through `timeout`                             | [Limits](workflows-spec.md#limits)                             |
| D52 | Under `timeout`, 124 or 137 is TIMEOUT only at the limit, grace is 10 s                     | [Limits](workflows-spec.md#limits)                             |
| D53 | An owner signal ends the ACP adapter group with no `session/cancel`                         | [1f-3](workflows-plan.md#1f-3-acp-harness-optional)            |
| D54 | The sweep ends no group for a passed deadline alone                                         | [Run states](workflows-spec.md#run-stage-and-check-states)     |
| D55 | Comments above the first stage travel with it on delete or move                             | [1b decisions](workflows-1b-decisions.md#saving-in-place)      |
| D56 | The strict whole-group deadline holds for GNU `timeout` only                                | [Limits](workflows-spec.md#limits)                             |
| D57 | A stage is TIMEOUT only when the harness reports TimedOut                                   | [Limits](workflows-spec.md#limits)                             |
| D58 | The shipped agents name their model once, and the synth system converts it per tool         | [Open questions](workflows-plan.md#open-questions)             |
| D59 | The manifest exempts only a markdown file whose front matter has no config key              | [Trust](workflows-spec.md#trust)                               |
| D60 | A link to a regular file is read as a file, and a refusal names its path and cause          | [Trust](workflows-spec.md#trust)                               |
| D61 | A repo agent file that Claude could read as the agent or as config makes its tools Unknown  | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D62 | The run state keeps the goal of a run, so the run history can list it                       | [Run states](workflows-spec.md#run-stage-and-check-states)     |
| D63 | A Claude `tools` item that starts with `-` makes the whole list Unknown                     | [Trust](workflows-spec.md#trust)                               |
| D64 | A Claude reply is kept to 16 MiB, and a cut reply is named in the failure note              | [Limits](workflows-spec.md#limits)                             |
| D65 | A `---` inside Claude agent front matter makes the file Unreadable                          | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D66 | Claude markdown is read lossy, and a Kiro JSON file that cannot be read is no definition    | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D67 | A Kiro agent is found by its JSON `name`, and the mention check reads the front matter only | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D68 | The trust scan, the manifest and the record are tightened after review of #175              | [Trust](workflows-spec.md#trust)                               |
| D69 | Kiro 3 agent files are found at any depth, as .json and .md, and a vague one refuses        | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D70 | A declared Kiro markdown agent shows unreadable tools, and does not refuse                  | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D71 | Kiro markdown closes its front matter at a line start, and no front matter is no agent      | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D72 | The #175 review rounds end at `258790f46` and the chain rebase starts                       | [Trust](workflows-spec.md#trust)                               |
| D73 | The Kiro summary and the launcher share one by-name lookup, and a markdown agent is refused | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D74 | The Claude launcher check uses the by-name lookup of the run, not an `<id>.md` file name    | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D75 | The real-server run of the stub suite skips the library cases, and the run cases are fixed  | [1g-2](workflows-plan.md#1g-2-agent-list-fields-and-history)   |
| D76 | `flow trust` compares the Kiro catalogs, and a V2 file in a subfolder is refused            | [Finding the agent](workflows-spec.md#harness-invocation)      |
| D77 | The Claude harness reads `result` from the head of a reply when the whole parse fails       | [Limits](workflows-spec.md#limits)                             |
| D78 | The Kiro launch uses absolute `PATH` folders, needs `kill`, and stops on SIGQUIT too        | [Limits](workflows-spec.md#limits)                             |
| D79 | `flow trust` checks the summary against both harness catalogs, whatever the index says      | [Trust](workflows-spec.md#trust)                               |

- **D1. One YAML file per workflow, with an ordered list of stages.** Why: a flat list reads in order, and it maps onto
  Kiro's `sequence` and Claude's `pipeline()`, which keeps exports possible. Rejected: Kiro's node tree, which authors
  nest; JSON, which has no comments. Consequences: loops and parallel stages (slices 4 and 6) need new stage kinds.
- **D2. The workflow name is the file name.** Why: a separate `name` key lets lookup, the canvas and the runner
  disagree, so `flow run a` could run workflow `b`. Rejected: a winning `name` key lets two files claim one name.
  Consequences: a file rename renames the workflow.
- **D3. Keys of later slices are reserved.** Such a key reports `NOT_SUPPORTED_BY_THIS_BUILD` with its slice. Why: a
  file naming a missing feature must fail, not run without it. Rejected: `UNKNOWN_KEY`, which reads as a typo.
  Consequences: the spec lists each planned key with its slice.
- **D4. Diagnostic codes are public API.** Why: tests and the canvas API contract depend on the names (12 are shared).
  Rejected: message text breaks on rewording; numeric codes are unreadable in logs. Consequences: a misnamed code stays;
  a changed rule keeps its code, and a new case gets a new one.
- **D5. Lookup is nearest-first.** Why: Konductor resolves a bare name to the project file, then the user file, then the
  shipped workflow. Kiro and Claude Code also prefer the project's workflow on a name clash
  ([Sources](workflows-exports.md#sources)), and an export would keep the same order. Rejected: user first lets a
  personal file override what a team committed. Consequences: a user file named like a shipped one wins a bare-name
  lookup, so `library/<name>` exists.
- **D6. Shipped workflows are built into the binary.** Why: an installed folder can be edited, deleted or drift from the
  binary. Rejected: a folder on disk, which is easy to patch but open to that. Consequences: a fix to a shipped
  workflow, even one prompt line, ships only in a new binary release.
- **D7. The engine is a Rust workspace under `workflow-engine/`** that holds the format rules.
  Why: the core stays free of IO and the canvas shares the generated types. Rejected: a library in `cli/konductor-rs`,
  tied to the CLI's release cadence. Consequences: a second CI workspace and a drift test against the canvas contract.
- **D8. A stage passes on evidence, not on exit status.** Why: a headless Kiro session with every tool call denied still
  exits 0. Rejected: taking the session's result unchecked, since a model can report a file it never wrote.
  Consequences: a stage whose final message has no valid result line is blocked even if the work is done.
- **D9. Runner harness and install harness stay separate.** Why: a workflow file names neither, so it survives changes
  to the runner program or agent-file format. Rejected: renaming `kiro-cli` to `kiro` in the canvas contract, which
  merges them. Consequences: `kiro-cli` runs, `kiro-cli-v2` and `kiro-v3` install. A run uses one runner harness, chosen
  with `--harness` or by what is installed.
- **D10. One function builds every agent stage's prompt** from a fixed preamble and the authored prompt. Why: every
  run gets the same shared text, tested by one golden file (a stored expected output). Rejected: treating every `{`
  as an error blocks JSON shapes like `{severity, file, line}`. Consequences: a preamble change updates every golden.
- **D11. A stage uses its agent's model.** The runner uses the model in the installed agent file or definition. Why: a
  canvas stage is a name and an agent, so its model is the agent's. Rejected: per-stage tiers (`fast`, `frontier`),
  since no first-release workflow sets one. Consequences: no per-stage override until slice 13. To use another model
  today, name another agent. An export adds a rule ([D11, export part](workflows-exports.md#decisions-for-exports)).
- **D12. A save writes the whole file with `base_hash`.** Why: a blind overwrite loses an edit made elsewhere, and a
  hash of the bytes read catches that for any key. Rejected: small edit operations send less, but every key needs one
  and the canvas drifts from the file. Consequences: the second of two editors to save is refused, and nothing merges.
- **D13. The canvas keeps up with the format, through one validator.** Why: a key the canvas cannot hold blocks the file
  or is dropped on save. Rejected: a second canvas validator, which can disagree with the runner. Consequences: a key is
  done when the canvas accepts, keeps and shows it, in the slice that adds it, with a control. A control may instead be
  built in a named step after that slice, and a value edit may use the `yaml` parser (D39).
- **D14. Project workflows run only after the user confirms them, once per workflow,** and anything a headless run loads
  from the repo takes effect only after trust. Why: three things execute instructions from the repo: the runner, `run`
  checks and the tool configuration a headless run loads from it (Claude's `.claude/settings.json` and
  `.claude/settings.local.json` hooks, `.mcp.json` servers, agent files for Claude and Kiro, and Claude's skills and
  commands).
  The runner asks on a terminal and shows what will run. A repo that carries tool configuration files needs confirmation
  for every workflow in it, shipped ones included. `flow view` never asks and never records trust. A Run from the
  canvas on a workflow that is still untrusted gets `trust_required` with the exact command, and the user answers that
  command's prompt in the terminal. The canvas never grants trust, and a [canvas save](workflows-spec.md#trust) that
  changes the workflow ends it, because script in the page or another holder of the session token can make that save.
  Rejected: each tool's own trust prompt, which covers neither the runner nor `run` checks; trust per repository, which
  a `git pull` that touches any workflow ends for all of them; a refusal that shows nothing about what will run and
  gives no way to confirm in place; keeping trust across a canvas save that adds no command and changes no agent,
  because the agents this design runs allow shell and file-write tools (`shell`, `fs_write` on Kiro; `Bash`, `Write` on
  Claude), so a prompt edit can run commands. Consequences: a change to a workflow or to one of its prompt files ends
  trust for that workflow only, from a `git pull` or a canvas save alike, and the next run asks again; approval pins the
  command line and not the code it runs, so a `run` check that calls a script runs whatever that script holds now; no
  setting turns trust off; the runner's design may add further files to the hash.
  Reverse: let a canvas Run on a loose file offer the trust prompt with the working folder as the root.
- **D15. The runner checks during the run.** Why: Konductor watches the run, so a failed check halts the stage at once.
  Rejected: checking only at the end finds a failed check late. Consequences: `flow verify <run-id>` runs the checks
  again later, and `unverified` exits 0, so a caller that needs proof reads the result. A native run is checked at its
  end ([D15, export part](workflows-exports.md#decisions-for-exports)).
- **D16. The runner supports Kiro V2 and V3 and sets the engine flag itself.** Why: a `kiro-v3` file under `--v2` runs
  with no allow rules (D28), and V3 upgrades project `kiro-cli-v2` files in place. Rejected: V3 only drops V2 users,
  though Kiro plans V3 as the default. Consequences: two permission paths to test ([Harness
  invocation](workflows-spec.md#harness-invocation)).
- **D17.** Moved to [the exports note](workflows-exports.md#decisions-for-exports) with its number, because only an
  export needs it.
- **D18. `effort`, typed params, the string form of `intent` and per-stage `model` wait for slice 13.** Why: no
  first-release workflow uses them, and each needs a canvas control (D13). `params.<name>` stays because the ported SOP
  takes `diff_input` (required), `pr_url` and `output_file` (default `adversarial-review-report.md`), all strings.
  Rejected: shipping them early fixes shapes nothing exercises. Consequences: each reports
  `NOT_SUPPORTED_BY_THIS_BUILD`.
- **D19. The runner grants no tool access of its own.** It allows only the tools the agent's own definition lists. On
  Kiro the agent file is the single source of what the session may do without asking, and the runner passes no
  `--trust-tools` (D43). On Claude Code it passes `--allowedTools` with a rule for each tool in the agent definition's
  `tools`. On Claude Code, under `--agent`, a definition with a `tools` key caps the tools the
  session has, so the settings can only deny there. It never passes `--trust-all-tools` or a permission mode. Why: the
  agent's list and the user's settings record what the user allows, and with no allow rules a headless `claude -p`
  denies every call that needs approval. Rejected: `--trust-all-tools` or a broad permission mode, which allow every
  tool; asking users to widen their global Claude settings, which affects every Claude session. Consequences: a stage
  fails when its agent lacks a tool it needs. On a stock Claude install, `hello-plan` can write `PLAN.md`, because
  `Write` is in `k-architect`'s `tools`. Claude has no approval list separate from `tools`, so under the runner every
  tool a Claude definition makes available runs without asking. That is wider than the Kiro allow list of the same
  agent: `k-architect` on Claude also runs `WebFetch`, `WebSearch` and every `mcp__aws-mcp__*` tool without asking, and
  `k-architect` and `k-quality-assurance` also run `Agent`, which starts subagents.
- **D20. The format only grows.** Releases add keys, stage kinds and codes, and a key never changes meaning. Why: a
  workflow someone wrote or shipped keeps working after an upgrade. Rejected: a `format` bump per breaking change, which
  needs a migrator for each saved file, and nothing provides one. Consequences: a released key name is final.
- **D21. A fresh headless session per agent stage.** Why: a session starts with one agent's model and tool allow list,
  so stages that name different agents need separate sessions. A review or verify stage should also not see the
  reasoning of the stage it checks, and text an earlier stage handled stays out of the next stage's context unless it
  was written to a file. Each stage can be timed out, killed and re-run on its own. Rejected: one session for all
  stages, which cannot switch agents and lets a checker see the maker's reasoning. Consequences: each stage pays a whole
  session (6 to 11 s in 14 one-file runs). Evidence still comes from the files and checks, not the session (D8). A
  shared session could be an opt-in later for consecutive stages with the same agent and no independence need, which
  adds a key and changes no released one (D20).
- **D22. One OS file lock per workspace says whether a run is alive.** A run holds a lock on
  `<project root>/.konductor/runs/lock` for its whole run, and the kernel frees it when the owner ends. Why: a
  kernel-freed lock has no stale state to detect, and a reused PID cannot fool it. Rejected: a PID file with a start
  time check, which needs a dead-owner test that can misjudge a reused PID. Consequences: the PID, start time and run id
  in the lock file are for messages only. A reader that finds the lock free takes it and re-reads the state. If the
  state still says `running`, it ends the recorded session groups (D36) and then writes `halted`. A reader that finds it
  held only reads. A new `flow run` sweeps any
  other `running` run before it creates its own state. A refused run exits 75, and so does a platform that cannot lock
  (some network filesystems). Deleting the lock file by hand during a run is unsupported. Rules: [the dead-owner
  rule](workflows-spec.md#run-stage-and-check-states), [exit codes](workflows-spec.md#commands-and-exit-codes), plan
  steps [1d](workflows-plan.md#1d-stage-prompt-and-the-runner-on-the-fake-harness) and
  [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view). Reverse: go back to PID and start-time detection.
  Change the spec's dead-owner rule, its one-run-per-workspace text and the exit 75 row, the plan text of 1d and 1g, and
  the 1d lock tests.
- **D23. Trust is confirmed by typing the first 8 characters of the hash, and step 1e owns the checks around it.** Why:
  a key pressed before the summary was on screen is already waiting in the input, and a bare `y` would confirm what the
  user has not seen. Rejected: a y/N prompt. Consequences: a file that cannot be read has no hash, so there is no frame
  for it: a prompt file is exit 65, and a tool configuration file is exit 77 with `tool_config_unreadable`. Step 1e owns
  the scan limits, the re-check before each session, which sits in the runner in front of the harness port so every
  harness gets it, and exit 74 for a trust record that cannot be kept or changed. Step 1d owns the exit 74 for
  `home_unusable` (D25). Steps 1f-1 and 1f-2 only start sessions through the runner. Rules:
  [Trust](workflows-spec.md#trust), plan step [1e](workflows-plan.md#1e-trust). Reverse: restore the y/N prompt and the
  `u` frame. Change the spec's trust layout and asking text and the plan text and tests of 1e.
- **D24. A new run ends the sessions that a killed owner left behind.** Why: each session runs in its own process
  group, so a hard kill of the owner leaves it running, and only step 1f-1 has real sessions to track. Rejected: leaving
  them running and documenting the limit. Consequences: step 1f-1 records each session's process group and start time
  in the run state. A new run, after it takes the lock and before it marks the old run `halted`, terminates each
  recorded group that still exists and whose start time matches. A reader that halts a dead owner's run does the same
  sweep (D36). A normal exit still kills the groups directly, and step 1d needs no change. Rules: [sessions that outlive
  a killed owner](workflows-spec.md#run-stage-and-check-states), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: drop the sweep and document the limit.
  Restore the spec sentence "when the owner exits, its sessions and checks are killed" and remove the sweep from the
  plan text of 1f-1.
- **D25. The project root search stops at the git top folder,** the folder that holds `.git` (a file or a folder). It
  never goes above that folder and never reads the home folder. With no git folder, only the working folder is used.
  When the search finds no `.konductor/` (up to the git top folder, or in the working folder with no git folder), `flow
  run`, `flow trust` and `flow trust --revoke` exit 64 with "no .konductor/ found, run konductor init". This is a plain
  usage error with no code under `--json`, and `flow trust --revoke` removes nothing. `flow check` and `flow show` use
  the working folder directly, as they do on a loose file outside a project, and do not search upward. They do not
  refuse a `$HOME` root and need no `HOME`, and neither does `flow view`. A command that needs `HOME` is one that reads
  or writes the trust store or the Kiro home folder, or has to compare the project root with `HOME`: `flow run`, `flow
  trust` and `flow trust --revoke`. An unset or relative `HOME` there exits 74, with the code `home_unusable` under
  `--json`, as the trust store does. That check comes first. Those commands then compare `$HOME` with the git top
  folder, or with the working folder when there is no git folder. Equal paths match. Otherwise both paths are
  canonicalized (symlinks resolved), and a path that cannot be canonicalized matches only when the paths are equal.
  Canonicalizing also covers case-insensitive file systems, with no extra rule. A git top folder that is `$HOME`, or a
  working folder that is `$HOME` with no git folder, is refused with exit 77 and the code `project_root_is_home` under
  `--json`, and nothing is searched. These two codes are the only `--json` codes of the root rules. Why: it keeps the
  search inside the repository the user opened, and anything above it is outside what the trust record covers. A
  repository at `$HOME`, such as a dotfiles repo, would make every file in the home folder part of the project. A
  missing `.konductor/` means the project was never set up, so the command says so and creates nothing in a folder the
  user did not choose. Rejected: also stopping at the home folder, which still lets a search climb through folders the
  repository does not own. Also rejected: falling back to the working folder when no `.konductor/` is found, which would
  put run state and the lock in a folder the user did not set up. Consequences: widening the rule later is a small
  change, and narrowing it later could break users. A loose file outside a project still works with `flow check` and
  `flow show`. The tool configuration scan in [Trust](workflows-spec.md#trust) searches up to the same folder. `flow
  run` creates `runs/` and `.konductor/.gitignore` only inside an existing `.konductor/`. A script that gets exit 64
  from `flow run` in a repo that was never set up must run `konductor init` first. Rules: [project
  root](workflows-spec.md#commands-and-exit-codes), plan step
  [1d](workflows-plan.md#1d-stage-prompt-and-the-runner-on-the-fake-harness). Reverse: widen the stop rule and update
  its tests: the spec's project root paragraph and Trust section, and the 1d tests (inside a git folder, no git folder,
  a nested folder, a git top folder that is `$HOME`, a working folder that is `$HOME` with no git folder, a symlinked
  `HOME`, an unset or relative `HOME`, no `.konductor/`, and `flow check` and `flow show` on a loose file outside a
  project). To reverse the exit 64, fall back to the working folder and drop the test for the exit 64 when no
  `.konductor/` is found, and the spec sentence. To widen `flow check` and `flow show` to the same root search, update
  the spec's project root paragraph and the 1d tests. To widen `flow view` to the root search, do it with step 1g.
- **D26. `flow check` prints no trust hash when the repo tool configuration cannot be read in full.** It prints "trust
  hash: none" with the reason, leaves `trust_hash` out of its `--json` output and keeps its normal exit code. Why:
  `flow check` is not a trust command, so it is the smallest change, its output stays stable and no new code is
  invented. Rejected: printing an error or exiting 77 from `flow check`, which would make a read-only check act as a
  trust command. Consequences: `flow run` and `flow trust` still refuse with exit 77 and `tool_config_unreadable`. A
  script that reads `trust_hash` from `--json` must handle a missing field. Rules: [Trust](workflows-spec.md#trust),
  plan step [1e](workflows-plan.md#1e-trust). On a loose file, `flow check` prints the hash from the scan that starts at
  the working folder. Reverse: print the hash or an error instead. Change the spec sentence and
  the 1e tests that check the output and the JSON field.
- **D27. Kiro finds an agent file in its working directory or the home folder, and the working folder's definition
  wins.** Before D42, the trust summary also searched the folders above the project root. D42 supersedes that search:
  the summary uses the catalog Kiro uses (see D42 under [Decisions](#decisions)). The order stays: if the working
  folder and the home folder both define the same Kiro agent id, the working folder's definition wins, as Kiro does,
  and the trust summary names the file used. Rules: D42.
- **D28. A V3 agent file under `--v2` is not refused.** The runner picks the engine flag from the shape of the agent
  file: `allowedTools` is V2 and `permissions.rules` is V3. A file with neither or both exits 64. Kiro runs a V3 file
  under `--v2` with no allow rules, because it ignores `permissions`, so there is no exit 4. Why: the file is what the
  engine reads, and the install index can be wrong or missing. Rejected: refusing that pair with exit 4, which Kiro does
  not do and the runner would have to add. Consequences: the runner never starts that pair, because it passes the flag
  that matches the file. Run by hand, that pair gives an agent with no allow rules, and the trust summary of its tools
  would list rules that the engine ignores, which is never more than the session gets. Rules:
  [Kiro CLI](workflows-spec.md#harness-invocation), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: refuse a V3 file under `--v2` with exit 4, and
  restore the spec sentence.
- **D29. The `doctor` pin for `kiro-cli` is 3.3.0.** `konductor doctor` reports a lower version as a `warn`. Why: it is
  the one version the conformance checks cover, and it may not be a public release, so the pin is re-checked on a public
  release before release. Rejected: a pin that no run supports. Consequences: the 1f-1 tests of the version check name
  3.3.0. Rules: [Versions](workflows-spec.md#harness-invocation), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: change the pin and the 1f-1 tests that name it.
- **D30. How `--trust-tools` behaves on each Kiro engine.** D30 decided what the flag does on V3 and on V2 and which
  ids the runner could map from the agent's tools. D43 supersedes it: the runner passes no `--trust-tools` on either
  engine (see D43 under [Decisions](#decisions)). Rules: D43.

- **D31. The `tools` list of a Claude agent file is read in one way, and an item the runner cannot turn into a rule
  makes the whole list Unknown.** In a bare or whole-quoted one-line value, a comma inside parentheses does not split,
  so `Agent(a, b), Read` is two items. In the `[...]` form, a comma inside parentheses makes `tools` Unknown, because
  Claude itself reads that form as a YAML list. Unbalanced or stray parentheses are Unknown in every form, and block
  lists are read as before. The runner builds `--allowedTools` rules only from names that match `[A-Za-z0-9_*:.-]+` and
  do not start with `-` (D63), plus the one `Agent(...)` form. Any other item makes the whole list Unknown: no
  `--allowedTools` flag, one stderr note, and the summary line "tools: unreadable" plus the reason (D35). Why: the first
  draft could grant more tools than the trust summary shows, which breaks "less, never more" (D19). Both changes only
  narrow what a session gets.
  Rejected: guessing the intended items from a list that does not parse, because a wrong guess can grant a tool that the
  summary does not show. Consequences: the trust hash comes from file bytes, so existing trust records stay valid and
  only the summary text changes. An Unknown list pre-approves nothing, because the runner passes no flag. Rules:
  [Trust](workflows-spec.md#trust), plan step [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse:
  restore the plain comma split and the unchecked pass-through.
- **D32. The catalog finds a Claude agent by its `name` field, the way Claude does.** Claude resolves `--agent <id>` by
  the `name` in an agent file's front matter, and it scans `.claude/agents/` and its subfolders. A repo could ship a
  benign `<id>.md` and another file whose `name` is `<id>`, for example with `permissionMode: bypassPermissions`. The
  trust summary would show the benign file while Claude runs the other. The hash covers every file under
  `.claude/agents/`, so the gap is the summary, not the hash. Why: the summary must describe the agent that runs.
  Rejected: keeping the lookup by file name, which lets a repo file run that the summary never describes. Consequences:
  the hash is unchanged, so existing trust records stay valid. Only the summary and one new exit 77 case change: two
  repo files that declare the requested `name`, or a declaring file whose stem differs from that name, make the agent
  Unknown, and `flow run` and `flow trust` exit 77 with `tool_config_unreadable`. For a duplicate `name`, the trust
  summary names every file that declares it. `flow check` and `flow show` print that summary, and `flow run` and `flow
  trust` print the same text, then exit 77. The unreadable message prints the files. `flow check` still prints the hash.
  A file with no `name` is not an agent of that id. A name matches as an exact string, with no trimming and no case
  folding, and only `.md` files with front matter count. An unrelated agent whose name differs from its file stem blocks
  nothing. D44 sets which folders the Claude catalog searches and the exit 77 case for two catalogs. Rules:
  [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust).
  The duplicate-name summary is human text with no `--json` shape. The 1g contract (`openapi.yaml`) fixes one if the
  Designer needs it. Reverse: keep the lookup by file name and accept the gap. Restore the spec's `<id>.md` wording and
  drop the 1e tests of the `name` lookup. To give the summary a `--json` shape, add a field with the contract.
- **D33. The trust summary shows which of `permissionMode`, `hooks` and `mcpServers` a Claude agent file sets.** It
  lists the key names only, as it does for a settings file, and no values. There is no new refusal: the user sees the
  keys and confirms the hash. Why: an agent file can widen what its session does, for example with `permissionMode:
  bypassPermissions`, and the summary showed only its tools (D32). Rejected: refusing a file that sets one of these
  keys, which blocks agents that need them and cannot judge a value from a key name. Consequences: the hash is
  unchanged, so existing trust records stay valid. A user who confirms without reading sees the key names and not the
  values, so a value such as `bypassPermissions` is read in the file. Rules: [Trust](workflows-spec.md#trust), plan step
  [1e](workflows-plan.md#1e-trust). Reverse: add a refusal for `bypassPermissions`. Change the spec's summary bullet and
  the 1e tests of the summary lines.
- **D34. The `doctor` pin for `claude` is 2.1.323, and the runner does not use `--bare`.** `konductor doctor` reports a
  lower version as a `warn`. Why: 2.1.323 is the lowest build the checks ran on, and it may not be a public release, so
  the pin is re-checked on a public release before release. `--bare` does not load project agents, and Claude then exits
  1 for a project agent. Rejected: a pin that no run supports; `--bare` to skip repo hooks and servers, which would hide
  the stage's own agent. Consequences: the 1f-2 tests of the version check name 2.1.323, and a run still loads the
  repo's hooks and servers, so the trust rules of D14 stay. Rules: [Versions](workflows-spec.md#harness-invocation),
  plan step [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: change the pin and the 1f-2 tests
  that name it. Allow `--bare` only if project agents load under it.
- **D35. An empty `tools` list pre-approves nothing, and a space or a quoted item makes the list Unknown.** An empty
  list (`tools:` with no items, or `[]`) pre-approves no tool and gets no `--allowedTools` flag. A scoped rule with a
  space, such as `Bash(git status)`, or a quoted item in a `[...]` list makes the whole list Unknown, because only names
  that match `[A-Za-z0-9_*:.-]+` and do not start with `-`, plus the one `Agent(...)` form, pass (D31, D63). The summary
  line of an Unknown list reads "tools: unreadable" plus the reason, and the same line covers front matter the build
  cannot read in full. Why: each rule narrows what a session gets, and none grants a tool that the summary does not
  show (D19). Rejected: reading the space or the quote to build a rule, because a wrong reading can grant a tool the
  summary does not show. Consequences: the hash is unchanged. An agent that uses such an item has an Unknown list until
  it is rewritten, and its session gets no pre-approved tools. Rules: [Trust](workflows-spec.md#trust), plan step
  [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: accept spaces and quoted items by extending
  the charset and the reading rule. Update the spec sentence and the 1f-2 tests.
- **D36. A reader that halts a dead owner's run ends its recorded sessions first.** `getRun` on a run whose owner is
  dead takes the lock and re-reads the state. If the state still says `running`, it ends the recorded session groups,
  the same sweep as a new run (D24), and then writes `halted`. Why: halting alone would orphan the session, and the
  canvas reads the run before any new run starts. Rejected: halting only, which leaves the sweep to a later `flow run`
  that may not come. Consequences: the sweep comes before the write, so a reader that stops halfway leaves the state
  `running` and the next reader tries again. A reader that finds the lock held only reads and sweeps nothing. The reader
  rule of D22 is otherwise unchanged. Step 1d has no real sessions, so the sweep code arrives with step 1f-1, and
  `getRun` in step 1g calls it. Rules: [the dead-owner rule](workflows-spec.md#run-stage-and-check-states), plan steps
  [1d](workflows-plan.md#1d-stage-prompt-and-the-runner-on-the-fake-harness),
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli) and
  [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view). Reverse: halt only. Drop the sweep from the reader,
  and change the spec sentence of the dead-owner rule and the 1g tests.
- **D37. `flow view <name>` exits 64 when the name does not resolve to a file.** It starts no server. Why: `flow check`
  and `flow show` treat a name that matches no file as a usage error (exit 64), so the three commands agree, and a
  mistyped name shows at once instead of as an empty canvas. Rejected: a root with no file yet, which would let `flow
  view` open a new workflow. Consequences: the canvas API contract allows a root with no file yet, and the server of
  step 1g is stricter than the contract. `flow view` cannot start a new workflow. Rules:
  [Commands](workflows-spec.md#commands-and-exit-codes), plan step
  [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view). Reverse: allow a root with no file yet, so that `flow
  view` opens a new workflow. Change the spec sentence in Commands and the 1g test.
- **D38. The front matter of a Claude agent file may hold column-0 `- item` lists under `tools`, `skills` and
  `mcpServers`.** Indented lines under an `mcpServers` item belong to that item. A column-0 item under any other key,
  after a value, or after another key still makes the whole agent file unreadable. Why: installed Claude agent files,
  such as k-architect and k-developer, write `skills:` and `mcpServers:` as column-0 lists, and the old rule showed
  their `tools` as unreadable. Rejected: reading column-0 lists under any key, which would hide a malformed file.
  Consequences: the trust hash comes from file bytes, so existing trust records stay valid. Only the summary text
  changes, for files whose column-0 lists were unreadable before. Rules: [Trust](workflows-spec.md#trust), plan step
  [1e](workflows-plan.md#1e-trust). Reverse: allow the column-0 form only under `tools`. Change the spec sentence and
  the 1e test sentence.
- **D39. The Designer edits a stage `prompt` with a parser-based value writer, in step 1b-2.** Why: D13 gives every
  key a control, and the plan row for 1b only keeps `prompt`, so no step builds its control, while the 1g demo edits a
  prompt in the browser. A prompt is often a block scalar such as `>-`, and a review asked for a real YAML parser so
  that it can be edited. The 1b decisions note had deferred that question. Decision: step 1b-2, stacked on 1b, adds a
  multi-line prompt control and a writer that finds a value's range with the `yaml` package and replaces only those
  bytes. The line writer stays for `name`, `agent` and for adding, deleting and moving stages. The purity test of the
  Designer core allows `yaml` for that one module, and `yaml` moves from `devDependencies` to `dependencies`.
  `prompt_file` is shown read-only. Empty text removes the key. A read-back check parses each result and keeps the first
  form that reads back as typed. An existing block scalar keeps its style, then a
  literal block, then double quotes. A header comment is kept in a block, folded or literal, and dropped only when the
  text is double-quoted, which replaces the whole block without a refusal.
  Single-line text in a plain or quoted place is plain when it reads back as typed,
  else double-quoted, and never a literal block, also when a comment follows the value on its line. Text with a line
  break in a plain place or an existing quoted place is a literal block, then double-quoted, and double-quoted when a
  comment follows the value on its line, since no block is possible there. A comment after a plain or quoted value
  stays after the new value on its line. If no form reads back as typed, the
  writer refuses. Rejected: editing prompt text with the line writer, which cannot find the end of a block scalar.
  Consequences: a prompt edit is a canvas save that changes workflow content, so it ends trust as every such save does
  ([canvas rule](workflows-spec.md#trust), D14). The Rust loader and the `yaml` package may read some YAML differently,
  and the read-back check guards that on the canvas side only. `yaml` becomes a runtime dependency and the page bundle
  grows. The writer refuses a prompt edit, with a reason, for two `prompt` keys, an alias, anchor or tag on the prompt
  node, or a `<<` merge key, and the Designer shows "Saving a prompt ends trust. The next Run asks again." near the text
  area. Rules: [Saving a file](workflows-spec.md#saving-a-file), plan step
  [1b-2](workflows-plan.md#1b-2-the-designer-edits-a-stage-prompt). Reverse: drop the 1b-2 row and section from the
  plan, and change the 1b note bullet "The writer is a line writer for `name`, `agent` and whole stages, plus a `yaml`
  range pass for the `prompt` value" to a line writer alone. To keep the step and relax it, drop the refusals and the
  trust line from the 1b-2 section; the read-back check alone stays.
- **D40. The Designer refuses a prompt edit in a file that has a lone carriage return anywhere, or mixed line
  endings.** Why: the spec accepts a lone CR as a line break, but the `yaml` package does not read a lone carriage
  return as a line break, so no range of a value can be found, and the writer never guesses. A stray CR among LF lines
  is the same case. For mixed endings, the writer needs one line ending for the typed text, and a file with two kinds
  gives it none. Decision: keep the refusal. Each of the two refusals gives its own reason. It covers a lone CR
  anywhere in the file (CR-only breaks, or a stray CR among LF lines) and mixed endings of any two kinds (LF, CRLF,
  CR). Changes to
  `name`, `agent` and whole stages still save. Rejected: a lone-CR path in the writer, which adds a second line-break
  reader for a layout the package cannot read. Consequences: a person whose file has a lone CR or mixed endings edits
  the prompt in a text editor. The reason is shown in the Designer. Rules: [Saving a
  file](workflows-spec.md#saving-a-file), plan step [1b-2](workflows-plan.md#1b-2-the-designer-edits-a-stage-prompt).
  Reverse: add a lone-CR path to the writer that finds the ranges and writes with `\r`.
- **D41. A block scalar that ends a file with no final newline gets a final newline inside the edited value.** Why:
  the spec says a save adds no final newline, but the span of such a block runs to the end of the file. A clipped or
  kept block needs its last line break to read back as typed, and that break sits inside the span being replaced.
  Decision: accept it for block scalars only, and name it as the one exception in "Saving a file". It is inside the
  edited value, and no byte outside the value changes. In a CRLF file the added break is CRLF. A plain or quoted prompt
  on the last line of such a file changes only its value bytes, and no newline is added. Rejected: refusing the edit,
  which blocks every prompt edit on the last line of a file with no final newline. Consequences: after an edit of a
  block scalar, and only then, the file ends with a line break that it did not have. A plain or quoted prompt leaves the
  file without one. The save with no edit still returns the input byte for byte. Removing a key on the last line of a
  file with no final newline is a different case and still leaves the file without one. Rules: [Saving a
  file](workflows-spec.md#saving-a-file), plan step [1b-2](workflows-plan.md#1b-2-the-designer-edits-a-stage-prompt).
  Reverse: refuse such an edit with a reason.
- **D42. For Kiro, the trust summary, the ambiguity check and the hash scan use the catalog the harness uses.** The
  Kiro catalog is the project root, then the home folder, and the first definition wins. The file the summary names is
  the file the session runs. For Claude the catalog is the one of D44, and the fake harness uses the rule of step 1e.
  If the summary's catalog and the harness would resolve an agent to different files, `flow run` and `flow trust` exit
  77 with `tool_config_unreadable`. Why: a summary of a file that does not run tells the user nothing true, and the
  search above the project root could list an agent that Kiro will not run. This only reduces what a session can be
  granted or hidden from the user (D19), because the summary can no longer describe a file other than the one that
  runs. Rejected: keeping the folders-above search for Kiro, because the user would confirm text about a file that
  Kiro does not read. Consequences: an agent in a folder above the project root is not found for Kiro, and `flow run`
  fails before the first stage with the not-found message. A repo file can still shadow a home folder agent with the
  same id, and the summary names the file so the user can see which one runs. D42 supersedes the summary rule of D27.
  Rules: [Finding the agent](workflows-spec.md#harness-invocation), plan steps [1e](workflows-plan.md#1e-trust) and
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: build the summary from the folders-above
  catalog again and list both files. To change the same-id order, refuse with exit 77 when both files exist.
- **D43. The runner passes no `--trust-tools` flag on Kiro V2 or V3.** The agent file is the single source of what the
  session may do without asking, and the summary lists the agent's own allow rules. Why: the flag was a second source
  next to the agent file, it did nothing on V2, and it needed a map from tools to ids to keep right. This only reduces
  what a session can be granted (D19), because nothing is added to the agent file's rules. Rejected: keeping the flag
  on V3 with ids from the agent's list, because it adds a second source and a map to maintain for no new access.
  Consequences: a tool that the agent file does not allow is not allowed. The conformance check no longer tests the
  flag, and the spec and the plan hold no id mapping. D43 supersedes D30. Rules:
  [Kiro permissions](workflows-spec.md#harness-invocation), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: restore the flag with a corrected mapping.
- **D44. For Claude, the trust summary, the ambiguity check and the hash scan use the Claude catalog.** The catalog is
  the project root, then each folder above it up to the git top folder (D25), then the user folder, and an agent is
  found by its `name` (D32). If two catalogs would pick different files, `flow run` and `flow trust` exit 77 with
  `tool_config_unreadable`. Why: D32 made the summary describe the agent that Claude runs, and the same must hold for
  the folder it comes from. This only reduces what a session can be granted or hidden from the user (D19). Rejected:
  building the summary from one catalog and accepting that it may differ from what Claude runs, because the user would
  confirm a file that may not run. Carve-out for `claude-acp` (D45): the adapter loads the project root and the folders
  above it up to the git top folder, with no user folder, so that is its catalog. An agent that exists only in the user
  folder is a usage error, exit 64, before the first stage, and exit 77 does not apply to it. The user folder is not in
  this catalog, so an agent that exists in the project catalog and in the user folder is the project file, and the trust
  summary and the hash cover that file. Not verified: that the adapter runs the project file in that case, because it
  was not tried with the same name in both places. Consequences: the hash
  scan reads `.claude/agents/` in each folder of the catalog, as before, so existing trust records stay valid. D44 is
  the Claude twin of D42. Rules:
  [Finding the agent](workflows-spec.md#harness-invocation), plan steps [1e](workflows-plan.md#1e-trust) and
  [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: build the summary from one catalog and accept
  that it may differ from what the harness runs.
- **D45. The ACP harness is an optional step, 1f-3, behind the existing Harness trait.** The Agent Client Protocol (ACP)
  is a JSON-RPC protocol over stdio. The step adds a third adapter next to the Kiro and Claude adapters, as two
  `--harness` values, `kiro-cli-acp` and `claude-acp`. Why: today a stage is one process that the runner waits on and
  reads at the end, so a stage's output is not live, and Claude gives none. ACP gives live updates and lets one client
  drive any agent that speaks it. Consequences: the core, the runner, the run state, trust, the canvas and 1g do not
  change. The CLI harnesses stay the default and the fallback. The step needs 1f-2, blocks nothing and is not in the
  first release. The adapters, their commands, their protocol version and their agent selection were checked by hand on
  one build of each ([Sources](#sources)). Both select the named agent. A harness that cannot select it is not
  released, with no fallback to a default agent. The same catalog as the trust summary must pick the file (D42, D44).
  Rules: names and choice (the values are never chosen automatically, and the existing order stays); install and
  minimum (the engine installs nothing, `doctor` checks the minimum version only, with no upper bound, a version below
  the minimum is a `warn` that never changes the exit code, and a missing adapter at run time exits as a missing CLI
  does, with no silent fallback); protocol
  (ACP v1 only, the verified adapters serve v1, a v2-only adapter is refused when the first session starts, which
  blocks the stage with `SESSION_FAILED` and halts the run as usual, reevaluate if the adapters serve a later version);
  process control (one adapter serves one stage and ends with its process group when the stage ends, the group is
  recorded for the sweep as in D24, and at the stage limit the runner sends `session/cancel` and terminates the
  group in the same step, then kills it after one 10 second wait, while an owner signal sends no `session/cancel`,
  D53); output (the last 1 MiB, live updates go to the
  events sink only if that step exists, and updates are display data and never evidence, D8); limits on the adapter
  (in [Limits](workflows-spec.md#limits), and any breach ends the stage as `SESSION_FAILED`); agent file check (the
  runner hashes the agent file before and after each stage, and a change fails the stage). The text is in plan step
  [1f-3](workflows-plan.md#1f-3-acp-harness-optional) and the [Harness
  invocation](workflows-spec.md#harness-invocation) bullet points to it. Reverse: drop step 1f-3 and its rows (the CLI
  harnesses stay), use two waits (cancel then terminate then kill), or probe a v2 adapter once before the adapter
  starts and refuse it before the first stage.
- **D46. Over ACP, the runner answers each permission request from the agent file's own allow rules only.** The agent
  file stays the single source of what a stage may do (D19, D43), so there is no flag and no second source. The runner
  answers each `session/request_permission` by allowing it when a rule of the agent file matches. Otherwise it denies
  it, blocks the stage with the reason `SESSION_FAILED` and the denied tool in the stage message, and halts the run. It
  never grants more than the agent file, and any later change by the adapter to a different mode value fails the stage
  (setting `default` again is not a change). Why: ACP has no
  `--trust-tools` flag, and a request is the only place where a grant could be made. This only reduces what a session
  can be granted (D19). Consequences: a stage whose agent lacks a tool it needs fails, as under the CLI harnesses. The
  trust summary and the hash do not
  change. Matching is stricter than on the CLI harnesses, which hand their rules to Kiro or Claude Code: a rule
  matches a tool by its exact name, as `Agent(<id>)`, or as a prefix only when it ends in `_*`, `/*`, `:*` or `.*`, and
  any other rule text matches nothing. A canvas prompt for a permission is out of scope. Rules: plan step
  [1f-3](workflows-plan.md#1f-3-acp-harness-optional). Reverse: restore the adapter's own prompts (not recommended), or
  change the matching function. A reason code of its own for a denied permission can be added later, if the step shows
  it is needed.
- **D47. 1g builds the contract it was cut for, and one follow-up step, 1g-2, catches up.** The canvas contract on the
  integration branch has grown since step 1g was cut. It gained the listing of the agents a stage may name, a
  description of what each editable key of a stage takes, the list of past runs, run events, the kind and the lines of
  each stage, and three session fields. The Rust server of 1g implements the contract of its own cut: the six
  operations of 1a (`createSession`, `getWorkflow`, `saveWorkflow`, `checkWorkflow`, `startRun`, `getRun`) and the
  fields they carry, and each stage's kind and lines (D48). 1g does not catch up with the later additions. Step 1g-2
  needs 1g and adds the listing of agents (`listAgents`), the field information (`stage_fields`, the description of
  what each editable key takes), the three session fields and the run history (`listRuns`), which needs the goal in the
  run state (D62). The build calls this step `1g-3`, because it is the third pull request of 1g. `getRunEvents` stays
  with the events step ([1h](workflows-plan.md#1h-run-events), the event sink and `events.jsonl`). Why: 1g's server
  and the stub suite needed the six operations when 1g was cut, and the server step was already about 5,800 lines,
  with reviewers asking for smaller changes. Rejected: pulling the catch-up into 1g, which would make that step larger.
  Consequences: the page needs `stage_fields` to load, so it does not load against the server of 1g alone, and 1g and
  1g-2 ship back to back. The session has no `capabilities` list before 1g-2. From 1g-2 on, a server lists the
  operations it serves, so a client can tell a server that leaves out `getRunEvents`. Rules: plan steps
  [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view) and
  [1g-2](workflows-plan.md#1g-2-agent-list-fields-and-history). Reverse: pull the catch-up into 1g. Drop the 1g-2 row,
  section and graph node, and move its API rows and tests into 1g.
- **D48. When 1g meets the grown contract, it also adds each stage's kind and range, and 1g-2 adds the three session
  fields.** The corpus tests of the canvas stub run against the integration branch. So 1g's corpus fixtures and the
  Rust server's stage output carry each stage's `kind` (the key that names the stage's kind) and `range` (the lines the
  stage takes up). Step 1g-2 keeps `listAgents`, the field information, the run history and the session fields: the
  Konductor version, the capabilities and the limits (D47). Why: the corpus cases that check `kind` and `range` would
  fail against a server that leaves them out. Rejected: leaving `kind` and `range` to 1g-2 and skipping the six corpus
  cases with a stated reason, which leaves 1g with a corpus it cannot fully run. Consequences: the 1g build sends no
  session fields, so it has no `capabilities` list, and 1g-2 adds the list with the operations the server serves. The
  spec rule "Stage kind and lines" already says the Rust server keeps each stage's source lines when it builds the
  view. Rules: plan step [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view) and the
  [contract requirements](workflows-spec.md#requirements-on-the-canvas-api-contract). Reverse: leave `kind` and `range`
  to 1g-2 and skip the six corpus cases with a stated reason.
- **D49. A session group is on record right after its spawn, and the owner ends it when a signal arrives.** While a
  session runs, the owner handles SIGINT, SIGTERM and SIGHUP, and on the Kiro harness SIGQUIT too (D78). It ends the
  recorded session group (terminate, grace, kill), marks the stage `blocked` with `SESSION_FAILED`, writes the run as
  `halted` and exits 1, the code of any halted run. There is no separate interrupted status (D78). The launcher records the group
  right after the spawn. If it cannot be recorded, the launcher stops the group and the stage fails as `SESSION_FAILED`
  with a message that the session was not started. The sweep never ends a group whose leader has ended, because its start
  time cannot be read once the leader is gone. It warns once and drops the record, so the next run does not warn
  again. Why: a session has its own process group (D24), so Ctrl-C, SIGTERM or SIGHUP reaches only the owner. The
  owner's deadline dies with it, and a session with pre-approved write and shell tools keeps changing the tree. The
  sweep ends a group only when it can match the recorded start time, so it never stops an unrelated process.
  Rejected: relying on the sweep alone, which covers a hard kill only. Consequences: a session group ends in one of
  three ways: the owner's normal exit, a signal that the owner handles, or the next run's sweep (D24, D36). SIGKILL
  cannot be handled and takes the third way. A group has no leader when the owner is dead and a member outlives the
  leader. That happens when `timeout` itself is killed (D51), and also when the program ends by itself while it has a
  background child, any background process and not only one that ignores the terminate signal, and `timeout` ends
  with it. The sweep cannot match such a group to its record, so it does not end it, and the child keeps running with
  no limit. This is a known gap, tracked in issue #388, and a marker could close it (an open question in the plan). A
  second signal during the grace is ignored (D78). A signal during the sweep and SIGPIPE are not decided here. A deadline that holds without the owner
  is D51. Rules: [sessions that outlive a killed
  owner](workflows-spec.md#run-stage-and-check-states), [Limits](workflows-spec.md#limits), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: drop the signal handling and keep the sweep
  only. Revert the recorded-on-spawn rule. For a group whose leader has ended, keep the record and warn on every run.
  Change the sweep paragraph of the spec and the engine text and tests of 1f-1.
- **D50. The runner shows a bounded tail of a session's stderr on the terminal and never writes it to the run state.**
  The tail is the last 4 KiB, and it is shown with the failure line. Why: with a session's stderr discarded, every
  first-run failure, such as a login that is missing or an old flag, read "exit status 1". Consequences: a run with
  no terminal shows no stderr. The tail is display data and never evidence (D8). Rules:
  [Limits](workflows-spec.md#limits), plan step [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse:
  show no stderr. Drop the Limits sentence, the engine clause of 1f-1 and its test.
- **D51. A session's deadline holds without its owner, because the session program runs under `timeout`.** The
  launcher starts the session program under `timeout` (GNU `timeout`, or `gtimeout` where it exists, found in an
  absolute folder of `PATH`, D78), with the stage's
  deadline and a kill grace of 10 seconds. `timeout` is the group leader. GNU `timeout` ends the whole group at the
  deadline, and D56 says what the other flavor does.
  If neither program is on the PATH, the launcher runs the program directly and prints one warning, and the limit
  then depends on the owner. The limit holds without the owner only with GNU `timeout` or `gtimeout` on the PATH. The recorded group carries its absolute deadline. Why: the deadline lives only in the
  owner's loop, so only a process that outlives the owner can hold the limit, and `timeout` is the smallest change that
  does it. Rejected: a watchdog of our own, a second process with its own failure modes that needs a design of its own.
  Consequences: this replaces the plan's open question about a deadline that outlives the owner. D56 refines the
  whole-group guarantee. A group left without a leader, by a killed `timeout` or by a program that ends while it has a
  background child, is not ended by D49, and finding the members of such a group is an open question in the plan
  (issue #388). Rules:
  [Limits](workflows-spec.md#limits), [sessions that outlive a killed
  owner](workflows-spec.md#run-stage-and-check-states), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: run the program directly and accept a
  deadline that holds only while the owner lives. Drop the `timeout` text of Limits and the engine text and tests of 1f-1.
- **D52. Under `timeout`, a session exit status of 124 or 137 is `TIMEOUT` only at the limit, and the kill grace is 10
  seconds.** Under `timeout`, the launcher reports a session exit status of 124 or 137 as `TimedOut` (D57) only when its
  own clock has reached the limit. An earlier 124 or 137 is a normal exit and becomes `SESSION_FAILED`. Without
  `timeout` (the fallback), an exit status is never reinterpreted. The launcher runs `timeout -k 10 <limit in seconds>`,
  so the kill grace is 10 seconds. Only the session program of the Kiro and Claude harnesses runs under `timeout`. The
  ACP adapter does not, and its limit stays owner-based (D45). The checks, with their 10 minute limit, keep the
  owner-based limit. Why: a session that exits early can return 124 or 137, so the status alone is not proof of a
  time-out. Wider wrapping than the Kiro and Claude session programs can come later. Consequences: an ACP adapter or a
  check has no deadline that outlives a killed owner. Running them under `timeout` is on the [deferred
  list](workflows-spec.md#deferred-to-a-later-slice). Rules: [Limits](workflows-spec.md#limits), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: run the ACP adapters and the checks under
  `timeout` too, a wider wrapper. Or read every 124 or 137 as `TIMEOUT`.
- **D53. On SIGINT, SIGTERM or SIGHUP the owner ends the ACP adapter group and sends no `session/cancel`.** The owner
  kills the adapter group (terminate, grace, kill) as it does for any session group (D49). `session/cancel` is sent only
  at the stage limit, with the terminate signal (D45). Consequences: [Limits](workflows-spec.md#limits) and plan step
  [1f-3](workflows-plan.md#1f-3-acp-harness-optional) say the same, and D45 names the stage limit only. Rules: plan step
  1f-3 and Limits. Reverse: send `session/cancel` on the owner signals before ending the group.
- **D54. The sweep does not end a group because it is past its recorded deadline.** It already ends the group of any
  dead owner whatever the deadline, and a live owner enforces its own limit. The deadline in the record is only named
  in the sweep's note. Why: the sweep ends a dead owner's group whatever its deadline, so the recorded deadline adds
  nothing. Consequences: a leaderless group stays as D49 and D51 say. Rules:
  [sessions that outlive a killed owner](workflows-spec.md#run-stage-and-check-states). Reverse: end a group that is
  past its deadline, and change the sweep paragraph of the spec and the tests of 1f-1.
- **D55. Comments above the first `-` of the stages list travel with the first stage when it is deleted or moved.** The
  rule is the same as for later stages, blank lines included. Why: a comment that introduces the first stage would
  otherwise stay behind and read as a note on another stage. Consequences: the line writer takes that run with the first
  item. Rules: [1b decisions](workflows-1b-decisions.md#saving-in-place), [Saving a
  file](workflows-spec.md#saving-a-file). Reverse: stop the run at a blank line for every stage.
- **D56. The strict whole-group deadline holds for GNU `timeout` only, and the launcher tells the flavors apart.** The
  `timeout` program has two flavors. GNU coreutils `timeout` ends the whole process group at the limit. The uutils
  `timeout` only signals the group with TERM, so a descendant that ignores TERM can outlive the limit when the owner is
  dead. The launcher runs `timeout --version` once per path, with a 2 second bound, and caches the answer for the
  process. Output with "GNU coreutils" means GNU, and anything else is the weaker flavor. The strict guarantee is stated
  for GNU only. With the other flavor, the owner loop still kills the group while the owner lives. Why: GNU `timeout`
  ends the whole group, the other flavor only signals it, and a watchdog is a second process with its own failure modes.
  Rejected: a watchdog of our own (D51). Consequences: this refines D51. D49 and D52 keep their rules, and a watchdog
  stays on [the deferred list](workflows-spec.md#deferred-to-a-later-slice). Rules: [Limits](workflows-spec.md#limits),
  [sessions that outlive a killed owner](workflows-spec.md#run-stage-and-check-states), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: build the watchdog and state the guarantee for
  both flavors.
- **D57. A stage is `TIMEOUT` only when the harness reports that the session timed out.** The harness verdict is
  `SessionEnd::TimedOut`. The runner reads that verdict and never compares elapsed time itself. Under `timeout`, the
  launcher reports a status of 124 or 137 as `TimedOut` only when its own clock has reached the limit (D52), so the
  clock can veto a status but never supplies the verdict. Why: a suspend or a clock step must not turn a finished stage
  into a blocked one. Consequences: a stage that ends normally after the limit is not `TIMEOUT`. The fake harness is for
  tests only, and the spec's [`--harness` rule](workflows-spec.md#commands-and-exit-codes) says how the CLI marks its
  summary. A cargo feature gate for the fake harness is a follow-up that must land before the first release, listed in
  the plan's [open questions](workflows-plan.md#open-questions). Rules: [Stage result](workflows-spec.md#stage-result),
  [Limits](workflows-spec.md#limits), plan steps
  [1d](workflows-plan.md#1d-stage-prompt-and-the-runner-on-the-fake-harness) and
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: restore the elapsed check. The fake harness
  suffix is text only.
- **D58. The shipped agents name their model once, in the canonical spec, and the synth system converts it for each
  tool.** The base is the `model` of `agents/*.agent-spec.json`, which is `claude-sonnet-5.5`. The system that already
  converts the canonical form for Claude, Kiro v2 and Kiro v3 is `cli/konductor-rs/src/cli/synth/`. Its Claude writer
  has converted the model since #105, merged on 30 October: `claude_model_id` turns a Kiro dotted id such as
  `claude-sonnet-5.5` into `claude-sonnet-5-5`, turns `auto` into `inherit`, and passes any other string through, so an
  install writes the dashed form into every Claude agent file. No "model-id" step is needed. Kiro keeps the canonical
  form. Why: on the build the checks ran on, Claude Code knows the dash form only, and a hand run of 1f-2 with the dotted
  name fell back to Opus, and three runs ended 503. One base and one converter leave
  no second map to drift, and the fix reaches every Claude install, not only the runner. Rejected: a second mapping in
  the harness, a hand-written model string in harness code, and renaming the shipped specs, which would change the Kiro
  agents and the benchmark pin. Consequences: D11 holds, because a stage uses the model in the agent file that the
  install wrote. A Claude run of an installed shipped agent uses the converted model. The conformance suite and the `hello-plan`
  scratch agents are built from the synth output, and the conformance suite's own model constant gets a guard or a
  comment against drift (1f-2, #232, open). Not verified: whether Claude Code outside this machine accepts the dotted form. Rules: plan [open
  questions](workflows-plan.md#open-questions). Reverse: write the canonical name verbatim again and rename the shipped
  specs.
- **D59. The install manifest exempts a file from the trust hash only if it is a markdown file whose front matter is
  readable and has no key that can carry config.** The manifest is a file of the repo, so it vouches for itself. Only a
  markdown file can be left out, and only when its front matter has none of `hooks`, `mcpServers`, `permissionMode`,
  `tools`, `allowedTools`, `allowed-tools` or `memory`. Every other file is hashed whatever the manifest says: the
  settings and MCP files, the files under `.claude/hooks/` and `.kiro/agents/`, a script or any other file that a skill
  or a command can run, a markdown file whose front matter this build cannot read in full (D61), and a markdown file
  that is not UTF-8. D68 inverted the first rule of this decision: it listed the files that always count, and a file
  that the manifest recorded was left out unless it was on that list. Why: a repo that ships its own manifest could otherwise list a hook or an agent file
  it wrote, and the run would skip it. Rejected: keeping the exemption for every listed file, which is a bypass of the
  hash; dropping it, which would ask on every project install. Consequences: the agent files and skills of a project
  install that carry those keys now count toward the hash, so an update that changes them asks again once. Per-file
  hashes in the install index in the home folder would lift the restriction
  ([deferred](workflows-spec.md#deferred-to-a-later-slice)). Rules: [Trust](workflows-spec.md#trust), plan step
  [1e](workflows-plan.md#1e-trust). Reverse: exempt every file the manifest records, as before. D68 holds
  the current rule.
- **D60. A link to a regular file is read as that file, and a refusal of the scan names its path and cause.** In the
  tool configuration scan and in the Claude agent catalog, a link to a regular file counts as the file: the scan hashes
  the bytes of its target together with the link's own path, and the catalog reads the target. A link to a folder and a
  link that leads nowhere are refused with the path named, and so are the limits that stay: 512 entries, depth 4, 1
  MiB for a file and 16 MiB of files in all (D68), and a link in place of a folder above a covered path, such as
  `.claude` (D68). The exit 77 message and `flow check` name the path that refused and the cause. The halt after a re-check names
  the first path that differs or cannot be read, and the reason, also in the stage's failure note. It says "changed
  since the run started" when no confirmation was needed. Why: Claude Code follows a link to a file, so a hash that
  stopped at the link would not cover what runs, and a refusal that named no file gave the user nothing to fix. Raising
  the limits or exempting assets would shrink what the hash covers. Rejected: following a link to a folder, and raising
  the caps. Consequences: a skill with large or linked assets is refused until a scoped escape exists (a hash of a
  link target, a size frame, or an exempt kind of non-executable asset), which is listed in the [open
  questions](workflows-plan.md#open-questions). Rules: [Trust](workflows-spec.md#trust), plan step
  [1e](workflows-plan.md#1e-trust). Reverse: refuse every link again and drop the names from the messages.
- **D61. A repo agent file whose front matter Claude Code could read as the agent's id, or as carrying config, makes
  the agent's tools Unknown.** The Claude catalog finds an agent by its `name` (D32). A file is `Unreadable` when its
  front matter is not fully readable, or its `name` key is not a plain `name:` line at column 0, and its text mentions
  the id, as written or once the escapes of a double-quoted value are decoded. The catalog then takes that file as the
  definition, so the search stops at its folder and the home file is not shown in its place. The summary names the file
  and reads "tools: unreadable" plus the reason, and the runner pre-approves nothing. The forms are listed under
  [Finding the agent](workflows-spec.md#harness-invocation). A plain `name:` value that is another agent stays
  readable, even when it contains the id (`k-developer-frontend`), and so does a file whose front matter never
  mentions the id. The install manifest never hides a file whose front matter cannot be read (D59). Why: Claude Code
  runs the repo file, so a summary that skipped it would show the home agent, and the user would confirm a file that
  does not run (D32, D44). The reviewer found a new form in several rounds, so one rule over the class replaced a list
  of forms. A seeded test against a YAML 1.2 reader with anchors and aliases resolved checks the rule. Rejected: naming
  the forms one at a time, and rewriting the front matter parser onto `workflow_core::yaml` before the step merges. The
  rewrite is a follow-up, because the reader decides refusals and the tests of the review rounds are its safety net.
  The user may still take it before the merge. Consequences: the rule refuses some files that are safe, with no
  override. The hash covers every file under `.claude/agents/` whatever the rule says, so existing trust records stay
  valid. Rules: [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust).
  Reverse: name the forms one by one again, or replace the reader with the engine's YAML loader and keep the test.
- **D62. The run state keeps the goal of a run.** `.konductor/runs/<run-id>/state.json` gains an optional `goal` key
  that holds the goal text. The run history (`listRuns`) returns the goal of each run, including a run that another
  process started, cut at 2048 characters. A state document written before the key reads with an empty goal. The
  history lists the runs of the open workflow, newest first. The state keeps whole seconds, so runs of one second are
  ordered by the creation time of their folders, then by id. `listRuns` reads under the dead-owner rule with `getRun`,
  through one shared function (D22, D36). Why: the contract's run summary has a goal, and the state document did not
  hold one. The goal is the user's own text, it already goes to the agent and into the run folder, and
  `.konductor/runs/` is git-ignored. Rejected: leaving the goal out, which leaves the history of the Run view without
  goals. Consequences: the goal text sits on disk in the run folder, with the rest of the state. The key has its own
  commit, so it can be dropped with `listRuns`. Rules: [Where run state
  lives](workflows-spec.md#run-stage-and-check-states), plan step
  [1g-2](workflows-plan.md#1g-2-agent-list-fields-and-history). Reverse: drop the key and `listRuns`, and skip the
  history tests of the real-server run again.
- **D63. A Claude `tools` item that starts with `-` makes the whole list Unknown.** The runner passes the rules as the
  argument after `--allowedTools`, so a repo-controlled item such as `--some-flag` would stand where an option can. On
  the build the checks ran on, the CLI reads it as a value, but that is undocumented and can change. Why: it only
  narrows what is passed (D19). Rejected: relying on that reading. Consequences: an agent with such an item has an
  Unknown list until it is rewritten, as in D35, and its session gets no pre-approved tools. Rules:
  [Trust](workflows-spec.md#trust), plan step [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse:
  allow a leading `-` and pass the rules as one `--allowedTools=<rules>` argument.
- **D64. The Claude harness keeps the last 16 MiB of a session's output, and a reply that was cut is named in the
  failure note.** The Claude reply is one JSON document, and its `result` comes before `usage` and
  `permission_denials`. With the 1 MiB tail of the other harnesses, a long reply lost its start, and a stage that had
  succeeded was reported as failed with "no result". The Claude harness keeps more, and D77 adds a head to the launcher.
  When a reply cannot be read and the output hit the cap, the failure note says that the output was truncated and
  names the cap. Why: the cause of the failure must show. Rejected: reading `result` from the kept tail of a cut reply,
  which is a follow-up in the [open questions](workflows-plan.md#open-questions). Consequences: a Claude reply over 16
  MiB still fails the stage, unless exit status 0 and a `result` in the kept head let the harness read it (D77). Rules: [Limits](workflows-spec.md#limits), plan step
  [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: keep 1 MiB for Claude and keep the note.
- **D65. Claude agent front matter ends at the first `---` after the opening line, and a `---` inside it makes the
  file Unreadable.** Claude Code splits the front matter lazily: it ends at the first `---` that follows the opening
  fence, wherever that `---` stands in its line. So Claude reads `name: k-architect---` as the name `k-architect`
  followed by the end of the front matter, while a reader that looks for a closing `---` line ends the front matter
  later and reads another agent. A file with a `---` before its closing `---` line is `Unreadable` (D61). A stem file
  shows its tools as unknown, another file counts when its text mentions the id, and the hash scan hashes the file
  (D59). Why: a reviewer found that `name: k-architect---` reads as another agent here and as `k-architect` in Claude
  Code. Rejected: copying the lazy split into this build, because the build would then follow a parser that Claude
  Code can change. Consequences: a file with a `---` inside its front matter, such as a description that contains a
  dash rule, gets an Unknown `tools` line until it is rewritten. Rules:
  [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust). Reverse: drop
  the form from the Unreadable list and from the 1e tests. D59 and D61 stay as they are. The cut is Claude's. A Kiro
  markdown agent is cut at the first line that starts with `---` (D71). Refusal: at the #175 head
  (`258790f46`) a lone file with this form does not refuse. `flow run` and `flow trust` show it with "tools: unreadable"
  plus the reason, pre-approve no tool, and ask for the hash as usual, and `flow check` still prints the hash, because
  the hash covers the file. Only an ambiguous agent exits 77 with `tool_config_unreadable` (two files declare the id,
  or a Claude file declares it under another file name, D32, D67), and so does an unreadable config entry (D60, D68).
  Two files that both have this form for the id are ambiguous.
- **D66. A Claude agent file that is not UTF-8 is read lossy, and a Kiro agent JSON file that this build cannot read
  is never shown as a definition.** The lossy read, with each bad byte read as U+FFFD, is for the Claude markdown path
  only. A Node.js reader does the same, so the file is checked as Claude Code would read it. A Kiro JSON file is never
  shown with tools unless this build can read it as JSON. A lenient reader finds the id (nesting to 128 levels, and a
  repeated key that is not read, are accepted), and a file that is not UTF-8, does not parse, or repeats `name` or
  `allowedTools` is an unreadable candidate. If its text mentions the id, as written or once the JSON escapes are
  decoded, it is ambiguous whatever its file name is. If it does not, it counts only when its file name is
  `<id>.json`, as unreadable and not ambiguous. The search stops at its folder and does not go on to a home file. This
  text replaces the earlier "strict" Kiro read, and a number that overflows an f64, such as `1e999`, also makes a file
  unparseable, as both Kiro engines refuse it (D69): the code at the #175 head (`258790f46`) reads leniently to find the id and
  still fails closed on what it shows, which D-104 changed. Why: what Kiro does with such a file cannot be checked
  here, so the build fails closed. Rejected: a lossy read for both paths. Consequences: a Kiro agent file that is not
  UTF-8 or not JSON blocks the run when it mentions the id, and shows its agent as unreadable when it is called
  `<id>.json` and does not. Refusal: a lone unreadable `<id>.json` that does not mention the id does not exit 77.
  `flow run` and `flow trust` show "tools: unreadable" plus the reason, pre-approve no tool, and ask for the hash, and
  `flow check` prints the hash. An ambiguous candidate exits 77 with `tool_config_unreadable`.
  Rules: [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust).
  Reverse: make the read lossy for both paths.
- **D67. A Kiro agent is found by the `name` in its JSON, and the mention check reads the front matter only.** Four
  rules, one amend. (1) For Claude markdown, the check for the id looks only at the text up to the first `---` after
  the opening fence, where Claude Code ends the front matter (D65). A file that names the id only in its body is not a
  candidate. (2) Kiro CLI names an agent by the `name` string in its JSON, so the catalog indexes the
  `.kiro/agents/**/*.json` files, in subfolders too (D69), by `name`, as it does for Claude markdown. A file whose `name` differs is not that agent,
  and `other.json` with `"name":"<id>"` is. A file `<id>.json` that is an object with no `name` is an ambiguous
  candidate, because Kiro 3 then takes the file name for the id (D68). Two files with that name make the agent
  ambiguous: `flow run` and `flow trust` print the summary text, then exit 77 with `tool_config_unreadable`, whatever
  `--trust` or `--yes` says, and `flow check` prints "tools: unreadable" with the reason and still prints the hash. A
  file that is not UTF-8 or not JSON follows D66 and D68: ambiguous when its text mentions the id, unreadable when it
  is called `<id>.json`, and not looked at otherwise. The working folder still wins over the home folder. (3) A Claude `tools:` value with text on an indented
  line after it makes the whole list Unknown, because the harness reads a longer list than this build does. (4) A `*`
  anywhere in a `tools` list means every tool, and the summary shows `*` alone. Why: the #175 description records three
  gaps found in review. A sibling agent whose body hands work to `k-developer` became a candidate and made the id
  ambiguous, with no override. Kiro finds an agent by `name`, so a file lookup by name `<id>.json` could describe a
  file that Kiro does not run. A continued `tools` value and a `*` item were read as a shorter list than Claude reads.
  Each gap let an agent file read one way here and another way in the harness. Rejected: keeping the whole-file
  mention check, and keeping the Kiro lookup by file name. Consequences: the mention check of D61 and D65 now covers
  the front matter only, and a Kiro agent in a file with another name is found. The hash is unchanged, so existing trust
  records stay valid. Refusal, by tip: a lone Unreadable file (D61, D65, D66) does not exit 77 at the #175 head (`258790f46`). A
  duplicate Kiro name, a duplicate Claude name, a Claude file whose stem is not the id (D32), and a Kiro candidate
  that mentions the id but cannot be read (D68) do. Rules: [Finding the
  agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust). Reverse: drop the amend.
  The mention check goes back to the whole text, Kiro files are looked up as `<id>.json`, and a continued `tools` line
  and `*` are read as before.
- **D68. The trust scan, the manifest exemption and the trust record are tightened after the review of #175.** One
  amend, nine rules. (1) The install manifest exempts only a markdown file whose front matter is readable and has none
  of `hooks`, `mcpServers`, `permissionMode`, `tools`, `allowedTools`, `allowed-tools` or `memory` (D59). A script such
  as `.claude/skills/x/scripts/run.sh` is hashed. (2) Before the prompt, the runner loads the record and checks that its
  folder can be written, so a damaged, newer or unreadable record, or a folder that cannot be written, is refused with
  exit 74 and a yes is never followed by a failure. (3) A link in place of a folder above a covered path
  (`.claude -> /elsewhere`) is refused with its path (D60). (4) The scan stops at 16 MiB of files in all, over every
  folder it searches, and says so. This is the scan cap and has nothing to do with the 16 MiB cap on a Claude reply
  (D64). (5) The refusal for a run with no terminal leaves `trust_hash` out of its `--json` envelope, so a script
  cannot feed the hash straight back to `--trust`. The refusal for a `--trust` that does not match keeps both hashes.
  (6) A Kiro agent file is read leniently to find the id, and a file this build cannot read is an unreadable
  candidate: ambiguous when its text mentions the id, whatever its file name is, and so is an `<id>.json` object with
  no `name` (D66, D67). (7) A Claude `memory` key is a carrying key. With a `tools` list the tools are unreadable unless
  the `memory` value is a plain word of letters that is not `user`, `project` or `local` (`memory: none`), whatever form
  the value is written in (D69), because Claude Code adds Read, Write and Edit, and the summary lists `memory` on the "also
  sets" line. (8) Documented, not fixed: `flow trust --yes` records trust with no terminal and no summary, so any
  process that runs as the user can grant trust that way, and can edit `~/.konductor/trust.json`, which has only its
  file mode. (9) Documented, not fixed: the tool configuration is checked before each stage, not after the last stage
  and not during a session, so a change made by the last stage shows at the next `flow run`. Why: two independent
  reviews of #175 at `45bd53cd8` found a manifest that vouched for a script, a refusal that came after the prompt, a
  link above a covered folder, an unbounded scan, a hash handed out in a refusal, a Kiro file that Kiro loads and this
  build refused to look at, and a `memory` grant that the summary missed. Rejected: keeping the list of files that
  always count, which let any other recorded file escape the hash. Consequences: a project install asks again for
  files that the old rule left out, such as a script. A scan over 16 MiB is refused. The trust text states what the
  record does not protect against. Rules: [Trust](workflows-spec.md#trust), plan step [1e](workflows-plan.md#1e-trust).
  Reverse: drop the amend. D59 and D60 go back to their text before it, and D67 stays.
- **D69. Kiro 3 agent files are found at any depth, as `.json` and `.md`, and one that this build cannot place
  refuses the run.** Kiro CLI 3.6.2, the real harness, loads `.kiro/agents/**/*.md` and `.json` files in subfolders at
  any depth, dotfiles included, and a pre-approved shell tool ran with no prompt from such a file. Kiro 2 loads the
  top-level `.json` files only, and this build cannot tell which engine a run uses, so the catalog looks at all of
  them, as deep as the config scan goes. Five rules. (1) The catalog walks `.kiro/agents` and its subfolders for `.json`
  and `.md`. A subfolder `.json` file follows the rule of a top-level one (D66, D67). (2) A markdown agent is read like
  the Claude path (D61), with the Kiro cut of the front matter (D71): its id is the front matter `name`, or its file
  stem when it has none. A file that opens a front matter block with no `name` and has the id for its stem is
  ambiguous, and so is one whose front matter this build cannot read in full and that may name the id. A file with no
  front matter block is not a candidate (D71). An ambiguous case exits 77 with `tool_config_unreadable`, whatever `--trust`
  or `--yes` says. (3) A Claude `memory` value is read in any form: a plain word of letters that is not `user`,
  `project` or `local` leaves the tools readable, and a tab and a comment, a value on the next line, a quoted or escaped
  value, an alias, a tag and a block scalar leave them unreadable (D68). (4) `useLegacyMcpJson` is a key a Kiro agent
  also sets, and the summary names it. (5) A JSON number that overflows an f64 makes the file unparseable, so it falls
  under the mention rule (D66). The hash already covered these files, dotfiles included. Why: a hand run of kiro-cli 3.6.2
  against #175 at `2231dc412` loaded agent files that the catalog never looked at, and a pre-approved shell tool ran
  with no prompt, so the summary did not show a grant that the harness gave. Rejected: reading the top-level `.json` files only, which
  is right for Kiro 2 and wrong for Kiro 3. Consequences: a Kiro markdown file that opens a front matter block with no `name` and has the id for its stem
  blocks the run until it is renamed or given a `name`. Parked, not designed (follow-up 23): `disallowedTools`
  is not subtracted from `tools`, so the summary can show more than the harness grants (an over-show, low); a link to a
  folder under `.claude/skills` is refused, such as `.claude/skills/foo -> ../../.agents/skills/foo`; the 512-entry
  cap refuses a tree of about 400 skills; and `~/.kiro` markdown and subfolder JSON files in the home folder are not
  checked, because it is not tested that Kiro 3 loads them. Stop rule: after the next red-team pass, if nothing grants
  more than the summary shows, the parked items stay parked and #175 goes to merge review. Rules:
  [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust). Reverse: drop
  the amend. D68 stays.
- **D70. A declared Kiro markdown agent shows unreadable tools and does not refuse the run.** A `.kiro/agents` markdown
  file whose front matter `name` is the id declares the agent, with the front matter cut as D71 says. This build does not read the tools and permission rules
  of a Kiro markdown agent, so the summary line reads "tools: unreadable" plus the reason (the tools are Unknown), the
  runner pre-approves nothing, and the user is asked for the hash as usual. `flow check` prints the hash, which covers
  the file. Why: a Kiro markdown agent is a normal file of a normal install, so refusing every one would block runs
  that are safe to ask about, and the line already says that the summary cannot list its tools. Rejected: marking
  every Kiro markdown agent ambiguous. Consequences: the user confirms a hash for an agent whose tools the summary does
  not list. The Kiro harness of step 1f-1 still refuses to start a session for it (D73). Rules:
  [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust). Reverse: mark
  every Kiro markdown agent ambiguous, so `flow run` and `flow trust` exit 77 for it.
- **D71. A Kiro markdown agent closes its front matter at the first line that starts with `---`, and a markdown file
  with no front matter block is not a Kiro candidate.** Claude's cut is unchanged: the first `---` anywhere after the
  opening fence (D65). For a Kiro `.md` file, `----`, `---x` and `--- # c` close the front matter, an indented ` ---`
  does not, and a `---` inside a line is plain text, so the `name` after `description: a---b` is read. A file with no
  opening `---` line has no front matter, and Kiro does not load it, so it is hashed and nothing more. The prompt file
  of a JSON agent (`<id>.md`, `prompts/<id>.md`) is therefore not a second declaration of `<id>.json`. A file that
  opens a block in a form this build does not take (a byte order mark, a blank line first, `---yaml`) still opens one:
  it is a candidate when the block mentions the id, and it may take its stem for the id like any nameless file. Why: a
  hand run of Kiro 3.6.2 loaded an agent with `description: a---b` before `name` and ran its shell tool with no prompt,
  because this build applied the Claude cut and hid the name (7 variants). The same pass showed an ordinary repo, with
  `<id>.json` next to its prompt file `<id>.md`, refused as a double declaration. Rejected: one cut for both harnesses,
  which is wrong for one of them. Consequences: a Kiro markdown file with no front matter is never an agent here. Parked
  (follow-up 24, not designed): a nameless subfolder file as ambiguous, a trailing no-break space or U+2003 in `name`,
  exact-case names, the meaning of `allowedTools` patterns on V2 and V3 (`@builtin`), workspace reads that need no
  prompt, V3 rewriting a project JSON once, home agents deeper than 4 levels, and a linked `.kiro/agents`. Rules:
  [Finding the agent](workflows-spec.md#harness-invocation), plan step [1e](workflows-plan.md#1e-trust). Reverse: drop
  the amend. D69 stays.
- **D72. The review rounds of #175 end at its head `258790f46`, and the chain rebase starts.** The stop rule of D69
  is met. The narrow red-team pass on `258790f46`, limited to the D71 case and the prompt-file layout, found no form
  where the harness grants more than the summary shows: 73 real Kiro 3 loads, none hidden, and two Claude fuzz seeds
  with no bad case. #175 (step 1e) is final for this round, with CI green and approval. The over-claims and display
  gaps that the pass listed are parked as follow-up 25 and are not promises of this design. The rebase round goes one
  step at a time, in this order: 1f-1, then 1f-2, then 1f-3, then 1g. A new comment on #175 restarts the loop only if it
  names a form where the harness grants more than the summary shows. The form list in the spec was redone from
  `agent_catalog.rs` at this head. Why: a review loop with no stop rule does not end, and the chain steps are built on
  1e. Rules: [Finding the agent](workflows-spec.md#harness-invocation), [Trust](workflows-spec.md#trust), plan steps
  [1e](workflows-plan.md#1e-trust) and 1f-1 to 1g. Reverse: reopen the review of #175, and hold the chain.
- **D73. The Kiro summary and the launcher share one by-name lookup, and a Kiro markdown agent is refused at the
  launcher.** The agent a Kiro session runs is found by the `name` in its JSON (D67, D69), by one lookup and one lenient parse
  that the trust summary, the engine pick and the Kiro harness all use (D78). The launcher does not look for `.kiro/agents/<id>.json`. The
  engine (V2 or V3, D16) is read from the text of the one JSON file that declares the agent. A Kiro markdown agent has
  no engine shape, so it has no engine, and so does an agent with two candidate files, a file this build cannot read,
  and a V2-shaped file below the top level of `.kiro/agents/` (D76).
  The harness then refuses with a plain message and no session starts. `flow run` makes the same check before the
  first stage and before the trust question, and a failure there is exit 64, as for a file with neither or both engine
  shapes. `flow check`, `flow show` and `flow trust` are unchanged: a Kiro markdown agent shows "tools: unreadable" and
  does not refuse there (D70). Why: ihmaws found that the summary and the launcher could read different Kiro files.
  For example, `k-developer.json` with the `name` `dev-old` and `team/dev.json` with the `name` `k-developer` gave a
  summary of one file and a session of the other. Rejected: keeping a file-name lookup in the launcher, which is two
  rules for one agent. Consequences: a Kiro markdown agent cannot run a stage until a JSON agent file of that id is
  used, and `flow run` on the Kiro harness reports an ambiguous agent as exit 64 before the trust
  question, while `flow trust` exits 77 for it. This is the behavior of #231 (step 1f-1), merged (squash `fa0694023`). Rules: [Finding the agent](workflows-spec.md#harness-invocation), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: drop the amend in #231 (squash `fa0694023`).
- **D74. The Claude launcher check uses the by-name lookup of the run, not an `<id>.md` file name.** Before a run on
  Claude Code, the check that every stage's agent is visible uses the same catalog lookup as the run: the agent is
  found by the `name` in its front matter (D32, D44). It does not look for `.claude/agents/<id>.md`. Why: one rule for
  the check and for the run, so a renamed agent file cannot pass one and fail the other, as in D73. Rejected: a file
  name check, which would contradict the lookup of 1f-1 and be a second rule. Consequences: the check passes for an
  agent in a file with another name, and the trust gate still refuses a Claude file that declares the id under another
  file name (D32, exit 77). The ACP harnesses of 1f-3 use the same lookup. This depends on #232 (step 1f-2), which is
  not merged: the text describes its head `435c773bd`. Rules: [Finding the agent](workflows-spec.md#harness-invocation),
  plan step [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: restore the file name check in #232
  (`435c773bd`).
- **D75. The real-server run of the stub suite skips the 34 library cases, and the 3 run cases are fixed or skipped
  with a reason.** The base of the 1g steps now holds the workflow library list, entry and copy operations (contract
  1.11.0) and an optional `name` on `POST /api/run` (1.12.0). Against the real server the stub suite then fails 37 new
  cases: 34 in the library cases, because the real server does not serve those endpoints, and 3 in the run cases,
  because the run endpoint does not take the name yet. The 34 library cases are skipped on the real server only, each
  with a named reason in the skip list, by the mechanism of the `getRunEvents` skips (the skip list of the stub
  suite and its README list). Serving the library is a new feature and not a gap-fill, so it is its own later
  step (follow-up 28). The 3 run cases are looked at first. If the server fix is small (about 150 lines or less) and
  needs no design choice, it is made inside #356, in the commit that builds the run endpoint. Otherwise they are
  skipped with a named reason in the same way. `scripts/e2e-real.sh` is diagnosed once these two are settled, fixed if
  the cause is the same base move, and a case for a feature the real server lacks gets the same named skip. No test
  is deleted. Why: a test of a feature the real server does not have is a lawful `NOT_SUPPORTED`, as the `getRunEvents`
  skips are, and a server change to the run endpoint may be a small contract gap, so it is checked before any skip.
  Rejected: serving the library inside 1g, which adds a feature to a step that is already large, and deleting the
  tests. Consequences: until the library step, the real-server suite shows the library skips, the library views of the
  page have no data on the real server, and `flow view` still lists no shipped workflows. This depends on #327 and
  #356 (step 1g), which are open and not merged. Rules: plan steps [1g](workflows-plan.md#1g-canvas-server-in-rust-and-flow-view)
  and [1g-2](workflows-plan.md#1g-2-agent-list-fields-and-history). Reverse: delete the new skips and serve the
  library.
- **D76. `flow trust` compares the Kiro catalogs whenever its catalog is not the Kiro one, and a Kiro V2 file in a
  subfolder has no clear engine.** This is the behavior of #231 (step 1f-1), merged (squash `fa0694023`). The text names no tests. (A) `flow trust` has no `--harness`, and it builds its summary from the catalog that a `flow run` without
  `--harness` would use. When that is the Kiro catalog (only a Kiro runner is recorded in the install index), nothing
  is compared. In every other case (no index, only `claude`, both runners, or neither) the summary comes from the
  Claude catalog when only `claude` is recorded and from the search from the working folder otherwise, and a
  `flow run --harness kiro-cli` needs no install record, so the comparison runs whatever the index says. The same holds
  for the Claude catalog (D79). It builds the Kiro catalog of the project root and, for each agent of the workflow that
  either search finds, compares the file that the search from the working folder picks with the file that the Kiro
  project-root search picks. A file with unknown tools is not a mismatch when both searches pick it. If the files
  differ, if one search finds none, or if either side is ambiguous, `flow trust` prints both files and exits 77 with
  `tool_config_unreadable`, whatever `--trust` or `--yes` says, and records no hash, in the same shape as the Claude
  mismatch check of 1f-2 (D44). The search from the working folder is not a superset of the Kiro search: the nearest
  folder that has the agent wins, so it can show a different file, and not more files. (B) Kiro 2 loads only top-level
  `.json` files of `.kiro/agents/`. A file of the V2 shape (an `allowedTools` list) below the top level leaves the
  engine unclear, like a markdown agent (D73), and `flow run` fails before the first stage with a plain message, exit
  64, and starts no session. A subfolder file of the V3 shape (`permissions.rules`) keeps working, because Kiro 3
  loads it. Why: ihmaws found on #231 that the user could confirm one agent file while another ran: a trust summary
  built from the nearest file, and a `--v2` flag for a file that Kiro 2 never loads. Both fail closed. Rejected:
  leaving the fallback catalog as it was, and passing `--v2` for a subfolder file. Consequences: when the summary is not built
  from the Kiro catalog, `flow trust` refuses a repo whose agent file in the working folder differs from the
  one at the project root, and a V2 agent kept in a subfolder cannot run until it is moved to the top level or
  converted to V3. Rules: [Finding the agent](workflows-spec.md#harness-invocation), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: drop the 1f-1 amends (#231).
- **D77. The Claude harness reads `result` from the head of the reply when the whole reply does not parse, and the
  launcher keeps a head on request.** This is the intended behavior of #231 (step 1f-1, merged, squash `fa0694023`) and
  #232 (step 1f-2, open and not merged). The launcher gains `Launch.keep_head_bytes` (a count of bytes, default 0, which changes
  nothing) and `Launched.head` (the first `keep_head_bytes` bytes of stdout). The Kiro harness sets 0. The Claude
  harness sets 64 KiB. When the whole reply does not parse and the exit status is 0, the Claude harness scans the head
  for the top-level `result` string field, with a bounded parse of an escaped string, and takes that. The 16 MiB tail
  and the truncation note of D64 stay. Why: knihit found that a session that exits 0 with a valid `result` was still
  judged `ResultMissing` when the reply was longer than the kept tail, and `result` comes before `usage`,
  `modelUsage` and `permission_denials`, so it sits in the head. Reading it removes a false failure at a small cost.
  The launcher change is in #231, in the commit that introduced the launcher, because #231 was already being amended
  (D76) when this was decided and one push and one rebase of the chain is less work than two. Rejected: a larger tail only, and a change to
  the Claude harness that does not touch the launcher, which cannot see the head. Consequences: a Claude reply over 16
  MiB with a readable `result` in its head passes the stage when the exit status is 0, and otherwise still fails with
  the truncation note. Rules: [Limits](workflows-spec.md#limits), plan steps
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli) and
  [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: drop the amends in #231 and #232. The 16 MiB
  tail and the truncation note stay.
- **D78. The Kiro harness runs `kiro-cli` from absolute `PATH` folders only, starts nothing without `kill`, and stops
  on SIGQUIT too.** This is the behavior of #231 (step 1f-1), merged (squash `fa0694023`). (B2) `kiro-cli` is looked up in the absolute folders of `PATH` only, as `timeout` and `gtimeout` are. A
  relative or empty entry (`PATH=/usr/bin:` or `:.`) could let a file in the repo stand in for it, and the trust hash
  covers tool configuration files and not programs. When it is not found, `flow run` exits 64 before the first stage
  with a plain message, and `konductor doctor` uses the same lookup. (B3) Without the `kill` program (`/bin/kill` or
  `/usr/bin/kill`) no session starts, and the stage ends as not started with a note that names it, because with
  `timeout` a leaderless run would leave the program with no limit. (B4) SIGQUIT (Ctrl-\) ends the session group like
  SIGINT, SIGTERM and SIGHUP do. (B5) The launcher prints one line when it starts to stop the session, and a second
  signal during the grace is ignored. The stage is `blocked` with `SESSION_FAILED`, the run is `halted`, and the exit
  code is 1, as for any halted run. There is no separate interrupted status. (B9) The agent lookup and the engine pick
  use one lenient parse of the agent file (D66, D73). (B1) A session group has no leader when the owner is dead and a
  member outlives the leader: when `timeout` is killed, and also when the program ends by itself with a background
  child. The sweep then warns and drops the record, and the child keeps running with no limit. This is tracked in issue
  #388. The limit holds without the owner only with GNU `timeout` or `gtimeout` on the `PATH`. Why: B2 was a program
  that the repo controls, run without a prompt. B3 left a session with no limit. The rest are cheap fixes, or
  statements in the text that were not true. Rejected: searching a relative `PATH` entry, and starting the session
  without `kill`. Consequences: `flow run` and `doctor` fail on a machine whose only `kiro-cli` sits in a relative
  `PATH` entry, and a machine with no `kill` runs no Kiro session. Rules: [Limits](workflows-spec.md#limits),
  [sessions that outlive a killed owner](workflows-spec.md#run-stage-and-check-states), plan step
  [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli). Reverse: drop the amends in #231.
- **D79. `flow trust` checks the summary against the catalog of each harness it was not built from, whatever the install
  index says.** This is the intended behavior of #232 (step 1f-2), which is open and not merged, on top of D76
  (#231, merged, squash `fa0694023`). `flow trust` has no `--harness`. Its summary comes from `trust_catalog`: the Kiro catalog when only a
  Kiro runner is recorded in the install index, the Claude catalog when only `claude` is recorded, and the search from
  the working folder in every other case (no index, both runners, or neither). Two checks follow, and each runs
  whenever `trust_catalog` is not that harness's own catalog. The Kiro check compares, for each agent, the file of the
  summary with the file of the Kiro project-root search (D76). The Claude check compares it with the file of the
  Claude catalog: the project root, the folders above it up to the git top folder, then the home folder, where the
  nearest definition wins. A later `flow run --harness claude` or `--harness kiro-cli` needs no install record, so the
  checks do not depend on the index. Files are compared by their resolved path, with links resolved, and not by the
  label a catalog shows, because a label is relative for the first folder searched and absolute for a folder above it.
  When the files differ, when only one search finds a file, or when either side is ambiguous, `flow trust` prints both
  files, exits 77 with `tool_config_unreadable` and records no hash, whatever `--trust` or `--yes` says. Where the two
  pick the same file, nothing is added. Why: the trust hash is the same whichever catalog built the summary, so the
  record would otherwise cover the run of a file that the summary did not show (ihmaws, #232). Rejected: checking only
  the harness that the index resolves, and comparing the labels. Consequences: with an index that records only
  `claude`, `flow trust` still refuses when a Kiro agent file in the working folder differs from the one at the project
  root. Rules: [Trust](workflows-spec.md#trust), plan steps [1f-1](workflows-plan.md#1f-1-process-launcher-and-kiro-cli)
  and [1f-2](workflows-plan.md#1f-2-claude-adapter-and-conformance). Reverse: drop the 1f-2 amends (#232).

## How it works

### Runner

How a run executes:

```mermaid
sequenceDiagram
    participant Runner
    participant Session
    loop each agent stage
        Runner->>Session: start a fresh session with the stage prompt
        Session-->>Runner: final message with the result line, and files written
        Runner->>Runner: check the result, the declared outputs and the done_when checks
        Runner->>Runner: pass the stage if all hold, else block it and halt the run
    end
```

- Every agent stage runs on the harness that `flow run` picks ([rule](workflows-spec.md#commands-and-exit-codes)): a
  headless Kiro CLI session with one agent or a headless Claude Code session. `fake` stands in for tests.
- The runner sets the engine flag (D16) and adds no tool access beyond the agent's own tool list (D19). It runs on the
  agent's model (D11) and reads the [stage result](workflows-spec.md#stage-result) from the reply
  ([invocation](workflows-spec.md#harness-invocation)).

### Exports

Exports to Kiro CLI and Claude Code are [slice 14](workflows-exports.md). The first release does not write native
workflow files.

### Trust

How the runner decides whether a project workflow may run:

```mermaid
sequenceDiagram
    actor User
    participant Flow as konductor flow
    participant Record as ~/.konductor/trust.json
    User->>Flow: flow run hello-plan
    Flow->>Record: compare the stored hash of this workflow with its current hash
    alt same hash
        Flow-->>User: the run starts
    else no record, or the workflow or one of its prompt files changed
        alt a terminal is available
            Flow-->>User: summary of what will run, then "Trust this workflow and run it?" (type the first 8 characters of the hash)
            alt the user types the first 8 characters of the hash
                Flow->>Record: store the hash
                Flow-->>User: the run starts
            else anything else, a bare y included
                Flow-->>User: exit 77, nothing ran
            end
        else no terminal
            Flow-->>User: exit 77, naming flow trust and --trust hash
        end
    end
    Note over Flow,Record: a canvas save that changes the workflow never moves the record, so the next run asks again
```

The runner asks once per workflow (D14). The [trust rules](workflows-spec.md#trust) say what the hash covers, where the
record lives and how a run without a terminal proceeds, and the [commands](workflows-spec.md#commands-and-exit-codes)
list which ones need trust. A Run from the canvas gets `trust_required` and does not grant trust. Which other repo files
count toward trust is left to the runner's design.

### Editing and the canvas

The canvas edits the file through the engine's validator, which replaces its TypeScript validator (D13), and saves the
whole file with `base_hash` (D12, [byte rules](workflows-spec.md#saving-a-file)). The canvas API contract needs
[these changes](workflows-spec.md#requirements-on-the-canvas-api-contract).

## First release

[The plan](workflows-plan.md) holds what each slice adds, what it needs and its tests. In short:

| Slice                                                                  | What the user gets                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [1 Skeleton](workflows-plan.md#slice-1-skeleton)                       | A file of stages and `file` checks that runs in the runner and opens in the canvas     |
| [2 Data between stages](workflows-plan.md#slice-2-data-between-stages) | `outputs`, templates and string params, so a stage reads what earlier stages wrote     |
| [3a Checks](workflows-plan.md#slice-3-checks-and-command-stages)       | `run` checks and `done_when`, so a stage passes only when Konductor has run its checks |
| [11a First port](workflows-plan.md#slice-11a-sop-library-first-port)   | The review workflow ported from the SOP, run in sequence                               |

### Export-ready invariants

Exports are later, so the first release must not close them off. It keeps these:

- `stage_prompt` stays a pure function of its inputs (D10), so an export can reuse the shared text.
- The format only grows (D20), so a workflow written now can be exported later without a migration.
- Evidence is defined by what exists (a result, declared files, checks), not by how the runner collects it.
- No first-release key has a runner-only meaning that an export could not express. A key an export can only state and
  not enforce, such as `outputs`, is fine.

## Threats

| Flow                                          | Threat                                                                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Residual risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo workflow files and `run` checks          | A cloned repo runs commands on checkout                                                                                                                                                          | No run before the user confirms the workflow, and the confirmation lists each `run` check; the hash covers the workflow file and its prompt files; `run` is argv with no shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A user who confirms without reading, or a script that a check runs and that changes after approval                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Trust record in `~/.konductor/`               | A process forges trust for a workflow                                                                                                                                                            | The record is outside every repo, so a clone cannot ship one, and the file has mode 0600                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Any process of the same user can write it, and so can a stage agent with a broad write tool                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Run state in `.konductor/runs/`               | A stage agent with a write tool edits or deletes its own run state, so a stage looks passed, a check looks `verified`, or the lock is lost                                                       | The runner decides `passed` and `verified` from its own in-memory results and from evidence it checks after the stage (declared outputs on disk, `done_when` run by Konductor), never from a value read back from the state files during the run. `flow verify` reruns the checks from the workflow file, whose trust hash it re-checks, not from commands copied into the run state                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A run state edited after the run can mislead `getRun` and any reader of it. A deleted lock lets a second run start. Worktree isolation (slice 12) is the fix                                                                                                                                                                                                                                                                                                                                                                                    |
| Repo tool configuration a headless run loads  | `claude -p` loads the repo's `.claude/settings.json` and `.claude/settings.local.json` hooks and `.mcp.json` servers with no trust prompt, and Kiro agent files in the repo set tool permissions | Trust covers what a headless run loads from the repo (D14): the hash covers `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.kiro/settings/mcp.json` and the files under `.kiro/agents/`, `.claude/agents/`, `.claude/commands/`, `.claude/skills/` and `.claude/hooks/`, and a repo that has them needs confirmation for every workflow. The files are read again before each session starts, and a change halts the run. An entry the scan cannot read in full (a link to a folder or to nothing, a folder over the file or depth limit, an unreadable file or name) refuses the run (D60), whatever hash is passed. `--bare` is unused (D34), and the summary and the hash scan use the catalog of the harness, so the file shown is the file that runs (D42, D44; [spec](workflows-spec.md#harness-invocation))           | A user who confirms without reading. A tool may load repo files this list does not name, such as the script a hook runs from outside `.claude/hooks/`; `CLAUDE.md` and steering text are not covered. A repo that is already an install target and ships its own `.konductor/manifest`, or a `git pull` that changes an installed file and the manifest together, is not asked about files that cannot carry config (D59). The fix is an install record of file hashes outside the repo ([spec](workflows-spec.md#deferred-to-a-later-slice))   |
| `--goal` text and param defaults              | They go into every stage prompt, so text that steers an agent reaches every stage                                                                                                                | The goal is capped at 2048 characters, and defaults sit in the file the trust hash covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | An agent follows instructions in any goal or default, so the person who writes or pastes one is the source. The agents' shell and file-write tools (`shell`, `fs_write` on Kiro; `Bash`, `Write` on Claude) let that text run commands                                                                                                                                                                                                                                                                                                          |
| Run params, such as the review's `diff_input` | A pull request author's text is rendered into every stage prompt, so it can instruct every agent                                                                                                 | A cap of 64 KiB per param and 100 KiB per stage prompt. Nothing else: the port needs no trust in a repo without tool configuration files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Accepted until worktree isolation (slice 12): text in a diff can lead to commands, file writes and network calls through the agents' shell, file-write and web tools                                                                                                                                                                                                                                                                                                                                                                            |
| A `KONDUCTOR_RESULT` line from an agent       | A forged or quoted line makes a stage look successful                                                                                                                                            | The runner takes the last such line only, and reported `outputs` are not proof: it checks declared outputs on disk and runs the `done_when` checks ([Stage result](workflows-spec.md#stage-result))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A stage with no declared output and no `done_when` check passes on its result line alone                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `prompt_file`                                 | A path leaves its folder or follows a symlink                                                                                                                                                    | Regular UTF-8 files inside the workflow's folder, under the trust hash                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The prompt can still tell an agent to do harm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Stage output read by the next stage           | One stage's file steers the next agent                                                                                                                                                           | Declared `outputs` and `done_when` checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | An agent can follow instructions in that file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Tools in a stage                              | An agent uses a tool its author did not expect                                                                                                                                                   | Only the agent's own list and the user's settings: the agent file's allow list on Kiro, with no `--trust-tools` (D43); `--allowedTools` from the definition's `tools` on Claude Code; no `--trust-all-tools` or permission mode (D19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The list or settings are trusted as written. A Claude agent runs every tool in its `tools` without asking, which is wider than its Kiro allow list (web, all `aws-mcp` tools and the subagents it may start)                                                                                                                                                                                                                                                                                                                                    |
| User-level workflows in `~/.konductor/`       | A file placed there runs in any repo with no trust                                                                                                                                               | None: user and shipped workflows need no trust, except in a repo with tool configuration files (first-release rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Accepted risk. A synced dotfiles directory is the user's own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| The canvas HTTP server                        | Another local process or web page calls the API                                                                                                                                                  | Requirements: loopback only; launch code; a token per session, kept only in the `sessionStorage` of the browser tab and the copies the browser makes of it; repo text rendered as plain text under a strict content security policy that a server sends as an HTTP header with `frame-ancestors 'none'` ([terms](workflows-spec.md#canvas-server)). A canvas save that changes a workflow ends its trust ([rule](workflows-spec.md#trust))                                                                                                                                                                                                                                                                                                                                                                                                          | A process of the same user that learns the token, or script in the page, can save a changed workflow, which then runs only after the user confirms it again in a terminal. A user who confirms without reading the summary                                                                                                                                                                                                                                                                                                                      |
| Secrets in messages and logs                  | A diagnostic or run log quotes a secret                                                                                                                                                          | A message never quotes a value that looks like a secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A secret that does not look like one, or one an agent writes to a file                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Sources

Public sources for the facts above about Kiro CLI and Claude Code. The facts that only an export needs are in
[the exports note](workflows-exports.md#sources).

| Fact                                                                                                                                                                                                        | Source                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Kiro flags: `--v2`, `--v3`, `--agent-engine` (v1, v2, v3), `--no-interactive`, `--agent`, `--trust-all-tools`                                                                                               | [commands page](https://kiro.dev/docs/reference/cli-commands/), [headless page](https://kiro.dev/docs/cli/headless/) |
| V3 skips V2 agent profiles until upgraded; it is planned as the default with CLI 3.0                                                                                                                        | [agent config](https://kiro.dev/docs/cli/v3/agent-config/), [CLI 3 post](https://kiro.dev/blog/cli-3/)               |
| In `claude -p`, an unapproved call is denied, and `--output-format json` returns the text in `result`                                                                                                       | [headless page](https://code.claude.com/docs/en/headless)                                                            |
| When subagents share a name, Claude Code uses, in order: managed settings, `--agents`, the project's `.claude/agents/` (the closest directory wins), `~/.claude/agents/`, plugins                           | [subagents page](https://code.claude.com/docs/en/sub-agents)                                                         |
| `claude --agent <name>` runs the session as that agent; `--allowedTools` lists tools that run without a permission prompt                                                                                   | [CLI reference](https://code.claude.com/docs/en/cli-reference)                                                       |
| Without `--bare`, `claude -p` runs the hooks in `.claude/settings.json` and connects the servers in `.mcp.json` in a folder never trusted; `--bare` skips them                                              | [headless page](https://code.claude.com/docs/en/headless)                                                            |
| ACP: local agents run as sub-processes of the editor and talk by JSON-RPC over stdio                                                                                                                        | [Agent Client Protocol](https://agentclientprotocol.com)                                                             |

Observed on one pre-release build, with the write tool only (the conformance check repeats them):

| Fact                                                                                                                                                                                                                | How we ran it                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A `kiro-v3` agent file run with `--v2` ran with no allow rules, because Kiro ignored its `permissions`                                                                                                              | One headless run of a `kiro-v3` agent with `--v2`                                                                  |
| V3 upgraded project `kiro-cli-v2` agent files in place at first launch, with `.bak` copies. Global agents not tried                                                                                                 | The first V3 launch in a project that held V2 agent files                                                          |
| Allow rules in the agent file work on both engines                                                                                                                                                                  | Headless runs of a locked and a writer agent on each engine                                                        |
| A headless session whose only tool call was denied exits 0 on both engines, with the failure only in prose                                                                                                          | Headless runs, empty allow list, each engine. Partial denial not tried                                             |
| A headless Kiro session prints the agent's final message on stdout, and a one-file run took 6 to 11 s end to end                                                                                                    | 14 such runs across both engines; a 15th exited 4 after 5 s, before any model turn                                 |
| `--bare` does not load project agents, and Claude exits 1 for a project agent under it                                                                                                                              | One headless `claude -p` run with `--bare` and an agent file in `.claude/agents/`                                  |

Observed on one build of each ACP adapter, run by hand through a small stdio driver in scratch folders. Agent files
were in the project, and the Kiro CLI was signed in:

| Fact                                                                                                                                                                              | How we ran it                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Kiro CLI serves ACP v1 with `kiro-cli acp`                                                                                                                                    | `kiro-cli acp --help`, then every frame logged by a small stdio driver                                                                                                                                                             |
| `kiro-cli acp --agent <id> --agent-engine v2` runs a V2 file (`allowedTools`), and `modes.currentModeId` in the answer to `session/new` equals the id                             | `kiro-cli acp --agent probe-v2 --agent-engine v2`                                                                                                                                                                                  |
| A V3 file (`permissions.rules`) runs with `--agent-engine v3`, and the agent is the session mode, set by `_meta.kiro.modeId` in `session/new`                                     | `kiro-cli acp --agent-engine v3`; the answer's `agentMode` equals the id                                                                                                                                                           |
| The `_meta.kiro.modeId` route is not in the public ACP specification, so the answer is the check. `session/set_mode` after `session/new` also works                               | The same V3 run, and one run with `session/set_mode` after `session/new`                                                                                                                                                           |
| The agent file's allow rules apply with no request, and an unlisted tool sends `session/request_permission`                                                                       | One agent per engine, with a listed and an unlisted tool                                                                                                                                                                           |
| Permission options are matched by `kind`, never by id. A V2 request carries a title and no tool id, so it can never match a rule                                                  | The options seen in the V2 and V3 requests                                                                                                                                                                                         |
| The default policy adds no allows: `cat` and `git status` each sent a request for an agent with empty `permissions.rules`                                                         | A V3 agent with empty rules, shell and write tools                                                                                                                                                                                 |
| The Claude ACP adapter serves ACP v1, and `_meta.claudeCode.options.agent` in `session/new` selects the agent, with the answer's `agent` config option equal to the id            | Adapter installed in a scratch folder; `claude-agent-acp --version`; `session/new`                                                                                                                                                 |
| The Claude adapter starts in mode `auto`, which runs a listed `Write` with no request. `session/set_config_option` with `configId: mode` and `value: default` fixes it            | A `Write` agent in mode `auto`, then `session/set_config_option`                                                                                                                                                                   |
| With `settingSources: ["project"]`, an allow rule in `.claude/settings.local.json` is not loaded and a request is sent. With the default sources it runs the tool with no request | A project agent with no `tools` key, a `touch` prompt, each source setting                                                                                                                                                         |
| An agent defined only in `~/.claude/agents` is not found with `settingSources: ["project"]`                                                                                       | The same project, with the agent file only in the home folder                                                                                                                                                                      |
| In a project `.claude/settings.json`, an allow rule did not apply and a deny rule did. The cause is unknown                                                                       | The rule was in the project `.claude/settings.json`, with the settings sources at their default and at project only. A permission request was sent in every run, so the allow rule did not apply. A deny rule in the same file did |
