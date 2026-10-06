# fuse-flow

fuse-flow keeps an agent on a defined process. 
You choose one of the pre-defined workflows, or define your own: an ordered sequence of activities and the artifacts they produce. 
The engine reads that workflow and the work done so far, and calculates the next step.

You will not interact with the engine. The agent guides you through the steps. But instead of interpreting prose instructions and reason about it, 
the agent invokes this deterministic program behind the scenes to decide the next step.


## Behind the scenes

You do not need to know any of this, but you're welcome to explore and understand what's happening.

The agent invokes `fuse-flow start` on the terminal, which prints what to do now. 
The agent does that work and runs `fuse-flow continue`, which checks and records
the step before printing the next one. fuse-flow refuses completion while required artifacts are
unaccounted for or a mechanical gate fails, and it hands decisions to the owner when required.

It is a small command line tool meant to be operated by agents. It runs the TypeScript sources
directly on [Bun](https://bun.sh), or on Node 22.18+, 23.6+ or 24+. Bun is the main runtime and
runs the tests.

fuse-flow is part of fuse-konductor and runs from the fuse-konductor clone. `install.sh` installs
the agent rules into a project or into a user-level instruction file and checks that Bun is
present. It does not copy fuse-flow. A global install writes the clone path into the rules. A
project install writes `clone=<path>` to `~/.konductor/fuse-konductor-clone`, so a committed
`AGENTS.md` stays the same for every developer. One clone serves any number of projects. Each
repository keeps its private workstream state under `.konductor/workstreams/`.

```bash
cd <your-project>
<fuse-konductor-clone>/fuse/flow/fuse-flow start my-feature --workflow _k-full-sdlc
```

When zod and yaml are missing from the clone's `fuse/flow/node_modules`, normally only on the
first run, fuse-flow downloads them from the npm registry with `bun install`, or with `npm install`
when only Node is present. That is the only time it uses the network. An offline run fails and
names the command to run.

In normal use, the agent runs the `fuse-flow` script by its full path. Every follow-up command
fuse-flow prints uses that same path, so nothing needs to be on `PATH`. This document shortens the
command to `fuse-flow ...`.

## The agent loop

A workstream is one piece of work, such as a feature, refactoring or story. Its workflow is an
ordered list of steps. The current step is the first step that is neither `COMPLETED` nor
`SKIPPED`.

1. `fuse-flow start <slug> --workflow <name or path>` creates a workstream and prints its first
   step. `fuse-flow start <slug>` resumes an existing workstream and prints its current step.
2. The agent follows the printed step block. When the work is done, it runs the printed
   `fuse-flow continue <slug>` command and accounts for produced and updated artifacts.
3. fuse-flow runs the mechanical gates, records the result, and prints the next step or an
   `OWNER'S TURN` hand-over block.
4. The agent repeats until the hand-over block says `STATUS: workflow complete`.

When the owner must decide, the agent presents the printed options with a recommendation and runs
the command for the decision only after the owner has made it.

## Workflow format

A workflow is YAML with `version: 1`, a `name`, an optional `description`, and one or more ordered
`steps`. Every step has a unique `id` and an `instruction`. `title`, `description` and `phase` are
optional information for readers and the viewer.

```yaml
version: 1
name: feature
steps:
  - id: research
    instruction: Map the existing behavior.
    condition:
      agent: the work touches an unfamiliar area
    optional_produces:
      - artifact: research-note
        path: docs/research/{slug}.md

  - id: spec
    instruction: Turn the request into an agreed specification.
    produces:
      - artifact: spec
        path: docs/specs/{slug}.md
    gates:
      - owner-action: approve the specification

  - id: implement
    instruction: Implement the approved specification.
    consumes: [spec]
    updates:
      - artifact: code
        path: src/
    gates:
      - check: default
      - agent: review the branch diff
        max_rounds: 2
        guide: reviews/code.md
      - owner-action: approve the change
        route_back_to: spec
```

The step fields have these effects:

- `instruction` opens the step block and says what the step must achieve.
- `condition` makes the step optional. It is written as one `owner-action`, `check`, `script` or
  `agent` mapping. A `check` or `script` condition runs when the engine reaches the step: exit 0
  runs it and another result skips it. An `agent` condition is judged by the agent. An
  `owner-action` condition asks the owner. A step without a condition is mandatory.
- `consumes` lists artifact identifiers from earlier steps. The step block prints each resolved
  input as `READ`, including the source step. A missing input is reported rather than refused, so
  the agent can recover it after a jump.
- `produces` contains one artifact mapping or a list. Each mapping has an `artifact` identifier,
  a `path`, and an optional `description`. Completion requires the path to exist or the agent to
  report `--not-produced <artifact> <reason>`.
- `optional_produces` has the same mapping shape. Existing paths are recorded, but missing paths
  never refuse completion.
- `updates` has the same mapping shape for artifacts that usually exist before the step, such as
  code. The agent accounts for every updated artifact with one or more `--updated <file>` flags,
  or with `--unchanged <artifact> <reason>`. A missing update path is reported and may be created.
- `--unchanged` and `--not-produced` name an artifact by its identifier or by its path, relative
  to the current directory. An identifier wins when a name is both. A path that several of the
  step's artifacts share is refused, and the artifact must then be named by its identifier.
- `{slug}` in an artifact path is replaced with the workstream slug, and `{date}` with the local date
  the workstream started (YYYY-MM-DD), which stays the same for the whole workstream.
- `gates` is one gate or a list. Gate kinds are `owner-action`, `check`, `script` and `agent`.
  Gates run in a fixed order: mechanical gates, agent reviews, then owner actions. List order does
  not change that sequence.
- `check: <kind>` names a lower-case check kind that policy binds to a command. `script: <command>`
  is a literal shell command. Both run from the repository root and must exit 0.
- `agent: <review>` tells the maker to obtain an independent review. `max_rounds`, at least 1,
  caps review rounds that end with a required fix. The default is 2. `guide` may name a review
  guide relative to the workflow file or by absolute path. fuse-flow prints these instructions;
  the maker counts the rounds and reports `--blocked` at the cap.
- `owner-action: <action>` leaves the completed work in `AWAITING_OWNER` until the owner decides.
- Any gate mapping may have `route_back_to`, as one step identifier or a list. Each target is the
  same step or an earlier step. It suggests routes for the owner's `--back-to` decision and does
  not create automatic control flow. A mapping may also have an informational `description`.

## Commands

| Command | What it does |
|---|---|
| `start <slug> [--workflow <name or path>] [--from <step>]` | Create or resume a workstream and print what to do. A new workstream requires `--workflow`. On a new workstream, `--from` starts at a later step and records earlier steps as skipped on the owner's decision. |
| `continue <slug>` | Finish the current step after its artifacts are accounted for and its mechanical gates pass, then print the next step or hand-over block. |
| `continue <slug> [--updated <file>]...` | Report each file revised under an `updates` artifact. Repeat the flag for several files. Files outside declared update paths are accepted and identified in the hand-over block. |
| `continue <slug> [--unchanged <artifact> <reason>]...` | Report each `updates` artifact deliberately left unchanged. Repeat the flag as needed. |
| `continue <slug> [--not-produced <artifact> <reason>]...` | Report each required `produces` artifact deliberately not written. Repeat the flag as needed. |
| `continue <slug> --blocked <why>` | Record that the agent cannot finish the current step, such as at the review round cap. The owner decides what happens next. |
| `continue <slug> --skip <why>` | Skip a conditional step, or skip any step after the owner explicitly asks. Records the reason. |
| `continue <slug> --owner-approved [--note <text>]` | Record the owner's approval of an `AWAITING_OWNER` or `BLOCKED` step and complete it. |
| `continue <slug> --more-rounds <n> [--note <text>]` | Add one or more review rounds to an agent gate on an `IN_PROGRESS` or `BLOCKED` step. |
| `continue <slug> --back-to <step> [--note <text>]` | On the owner's decision, reopen the named step and every later step from an `AWAITING_OWNER` or `BLOCKED` step. Files stay on disk. |
| `continue <slug> --forward-to <step> [--note <text>]` | On the owner's decision, skip the current step and every step before the later target. |
| `status <slug>` | Show all steps, their six states, gates, artifacts, skip reasons and the current step. |
| `validate <name, file or directory>...` | Validate one or more workflows without starting a workstream. A directory means every `.yml` and `.yaml` file below it, including nested and symlinked folders. |
| `help`, `--help`, `-h` | Print command usage, lookup paths and state location. |

`--note` is valid only with `--owner-approved`, `--more-rounds`, `--back-to` or `--forward-to`.
The owner decision flags are mutually exclusive. `--blocked` and `--skip` are mutually exclusive
reports, and artifact-reporting flags do not accompany either kind. Exit codes are 0 for success,
1 for a refusal, and 64 for a usage error.

## Output contract

The plain-text output is an interface for agents. A layout change is deliberate and should update
the tests and this section.

When it is the agent's turn, the step block uses these labels:

- `STEP` gives the step identifier, position and instruction.
- `CONDITION` explains why an optional step runs or how to skip it.
- `READ` gives each consumed artifact's path and source step.
- `PRODUCE` gives a required artifact path, identifier, guide and template information.
- `PRODUCE (optional)` gives an optional artifact in the same form.
- `UPDATE` gives an artifact path the step changes and reports when the path is missing.
- `WHEN THE WORK IS DONE` gives numbered gate and completion instructions.
- `REFUSED` gives the reason completion was refused, followed by the step block again.

When the owner acts next, output begins with `OWNER'S TURN` and ends with a pre-filled hand-over
block. The agent replaces placeholders, preserves the order, and ends its own message with these
five lines:

- `SUMMARY:` the task, workstream slug and step position.
- `STATUS:` one of `awaiting owner action`, `blocked`, `needs input`, `paused` or
  `workflow complete`.
- `PRODUCED:` new and updated files, or a compact summary for five or more files, plus reasons for
  artifacts reported unchanged or not produced.
- `VERIFICATION:` mechanical gate results, review rounds used and required fixes still open, or
  `none`.
- `NEXT STEP:` the owner's options, with the recommendation first and its reason.

fuse-flow pre-fills the block for `awaiting owner action`, `blocked` and `workflow complete`. The
agent writes it from `status` for `needs input` or `paused`.

## Files

### Workflows

A workflow reference containing a slash or ending in `.yml` or `.yaml` is a path. Otherwise a name
is looked up as `<name>.yml`, first in the project's `.konductor/workflows/`, then the user's
`~/.konductor/workflows/`, then `fuse/flow/workflows/` in the package. Within each location,
fuse-flow searches every folder at any depth, following symlinks, so a workflow may keep its own
files in a folder of its own, such as `examples/superpowers/`. The first location with a match
wins; two matches in one location are refused as ambiguous, wherever they sit.

The schemas in `src/schemas/` define the fields. `bun run schema` writes editor schemas to
`workflows/schemas/`. A workflow may point its editor at `workflow.schema.json`. fuse-flow checks
cross-field rules, including unique step identifiers, valid `consumes` references and backward
`route_back_to` targets. It reads the workflow again on every command, so edits affect running
workstreams.

### Artifact library

Each artifact identifier selects one folder with this layout:

```text
library/artifacts/<id>/
  entry.yml         optional; `description:` says what the artifact is (library-entry.schema.json)
  guide.md          how to produce the artifact
  template.<ext>    optional structure for the artifact
  review.md         optional review guide
```

The engine points the agent to a template but does not copy it. It searches the project's
`.konductor/library/artifacts/<id>/`, then the user's `~/.konductor/library/artifacts/<id>/`, then
the package's `fuse/flow/library/artifacts/<id>/`. The first existing folder wins as a unit, so
files are not mixed across library levels. An entry may also be filed in folders below
`artifacts/`, such as `artifacts/writing/<id>/`: a folder that holds only folders groups entries,
and any other folder is an entry named by the folder. An id found twice in one library is refused,
as a workflow name is. The engine does not use `entry.yml`; Komposer shows the
description and pre-fills a step's instruction from it. `library/gates/` is reserved; reusable gate
entries are not defined yet.

### Policy overrides

Policy binds workflow intents to a project. Files are read at these locations:

1. `~/.konductor/policy-overrides.yml`, personal defaults across projects.
2. `.konductor/policy-overrides.yml`, team policy checked into the project.
3. `.konductor/policy-overrides.local.yml`, personal policy for that project, normally gitignored.

A policy file may contain:

```yaml
checks:
  default: bun run check
  test: none
review:
  max_rounds: 3
  guide: reviews/default.md
  reviewer: a different model from the maker
artifacts:
  spec:
    path: docs/specs/{slug}.md
```

The complete override order, from general to specific, is: engine and package defaults, user
policy, workflow and gates, project policy, project-local policy, workstream state, then the
owner's recorded decision for approval, added rounds or a jump. In the implemented fields, project
and local policy override workflow values where defined. Check bindings and the reviewer use local,
project, then user policy. Artifact paths use local or project policy, then the workflow, then
user policy. Review `max_rounds` uses local or project policy, then
the gate, then user policy, then the engine default. A review guide uses local or project policy,
the project's artifact `review.md`, the gate's `guide`, user policy, then the user and package
artifact review guides.

### Workstream state

`.konductor/workstreams/<slug>.yml` records the workflow reference, each step's state, artifacts,
reported files and reasons, verification, granted rounds, skip reason and timestamped history.
Only fuse-flow writes it. The directory is gitignored.

## Rules

- **Order.** Steps run one at a time in file order. There is no parallel execution.
- **States.** `PENDING` has not been handed out. `IN_PROGRESS` is with the agent.
  `AWAITING_OWNER` has finished work waiting on an owner action. `BLOCKED` means the planned path
  broke down. `COMPLETED` and `SKIPPED` are terminal; a skipped step records `skip_reason`.
- **Artifacts.** Recorded artifacts are `draft` while an owner action waits and `approved` when
  their step completes, including steps without an owner gate. Sending work back makes approved
  artifacts draft again. `superseded` is available for a later artifact replacement process.
- **Refusals.** A missing unreported `produces` artifact, an unaccounted `updates` artifact, an
  unbound check, or a failed mechanical gate refuses `continue` and repeats the step block. The
  refusal is recorded but does not block the step or consume a review round.
- **Review cap.** The maker classifies findings, fixes required ones and repeats until a round is
  clean. A round ending with a required fix counts. At the printed cap, the maker reports the step
  blocked rather than starting another round. The owner can approve as is, grant rounds or send
  work back.
- **Jumps.** `--from`, `--forward-to`, `--back-to`, and skipping a mandatory step are owner
  decisions. After a jump, the agent restores missing consumed artifacts in the owner's interest
  and reports what it did.
- **Concurrency.** Mechanical commands run outside the state-file lock. If two commands try to
  advance the same workstream, only the first successful state update records the step.

## What fuse-flow does not try to do

fuse-flow tracks one engineer's workstream on one machine. It is not a security boundary.

- `continue` acts on the current step and has no step identifier. Run it once per step. The history
  makes replays visible.
- Commands in `script` gates and policy-bound checks run like Makefile targets from the repository
  root with the caller's environment. Use only trusted workflows and policy files.
- Owner-decision flags record the owner's word. They do not authenticate who typed it, so the agent
  runs them only after the owner decides.
- The engine does not create templates, infer check commands, count review rounds, compare file
  contents, or choose jumps.
- There are no parallel branches, path-choice constructs, workflow parameters, per-item loops or
  reusable gate library entries.

## Code

| File | Contents |
|---|---|
| `src/cli.ts` | Argument parsing, usage, printing and exit codes. |
| `src/commands.ts` | Command behavior and output blocks. Start here. |
| `src/workflow.ts` | Workflow loading and gate descriptions. |
| `src/workstream.ts` | State-file reading and locked updates. |
| `src/schemas/workflow.ts` | Workflow schema and cross-step validation. |
| `src/schemas/step.ts` | Step and artifact schema. |
| `src/schemas/gate.ts` | Gate and condition schema. |
| `src/schemas/policy.ts` | Policy override schema. |
| `src/schemas/workstream.ts` | Workstream state schema and migration. |
| `src/schemas/generate.ts` | JSON Schema generation. |
| `src/policy.ts` | Policy layering, artifact placement, library lookup and review guides. |
| `src/project.ts` | Repository root, workflow lookup and `.konductor/` paths. |
| `src/errors.ts` | Refusal and usage errors. |
| `fuse-flow` | Runtime launcher for Bun or Node. |

Tests: `bun test` in this directory. Each test runs the real command line in a throwaway repository.
