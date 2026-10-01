# fuse-flow

fuse-flow gives agents a deterministic lookup of the next workflow step, so that an agent does not
have to reason about it. `fuse-flow start` prints the current step: the skill to read, an inline
instruction, or both. The agent does the work and runs `fuse-flow continue`, which checks the step,
records it, and prints the next one. fuse-flow refuses a step whose artifacts are missing or whose
check fails, and holds a step until the owner approves it.

It is a small command line tool meant to be operated by agents only. It runs the TypeScript sources directly, on
[Bun](https://bun.sh) or on Node 22.18+, 23.6+ or 24+. Bun is the main runtime and runs the tests.

fuse-flow is part of fuse-konductor and runs from the fuse-konductor clone. `install.sh` installs the
skills and the agent rules into a project or into your user-level instruction files, and checks
that Bun is present; it does not copy fuse-flow anywhere, but it tells the agent where the clone is:
a global install writes the clone's path into the rules, and a project install writes it to
`~/.konductor/fuse-konductor-clone` (one line, `clone=<path>`) in your home directory, so the committed `AGENTS.md`
stays the same for every developer and each of them runs `install.sh` once from their own clone. One clone serves any number of projects, whether they
were set up with `--project` or `--global`. What differs per project is the state: each repository
keeps its own workstreams under `.konductor/workstreams/`.

```bash
cd <your-project>
<fuse-konductor-clone>/fuse/flow/fuse-flow start my-feature --workflow _k-full-sdlc
```

When the two dependencies, zod and yaml, are missing from `fuse/flow/node_modules` of the clone,
normally only on the first run, fuse-flow downloads them from the npm registry (with `bun install`,
or `npm install` when only Node is present, so Node needs npm next to it). That is the only time it
uses the network; offline, that run fails and says which command to run.

In normal use you do not type these commands. You ask the agent to start a new feature, and the
agent runs them, following the rules that `install.sh` adds to your instruction file. The agent
runs the `fuse-flow` script by its full path, and every follow-up command fuse-flow prints uses
that same path, so nothing needs to be on `PATH`. The rest of this document writes the commands as
`fuse-flow ...` for short.

## The agent loop

A workstream is one piece of work: a feature, a refactoring, a story. When it starts, you pick the
workflow it follows, such as `_k-full-sdlc`. fuse-flow is the state machine that runs it: the
workflow file is the graph of steps, the workstream's state is its current step (the first step in
the workflow that is not done), and there is one input, `continue`, which moves the workstream to
the next step and prints it.

1. `fuse-flow start <slug> --workflow <name>` mints the workstream and prints the current step: the
   skill file to read, the instruction, the artifacts to produce, the gate, and the `continue`
   command to run afterwards. In a new session, `fuse-flow start <slug>` resumes the workstream and
   prints the same thing.
2. The agent does the work and runs `fuse-flow continue <slug>`. fuse-flow checks the artifacts and
   the gate, records the step, and prints the next step.
3. Repeat step 2 until `continue` prints `workflow complete`.

When the printed step awaits the owner, or is blocked, the agent shows the owner the artifacts and
stops. After the owner has said yes, `fuse-flow continue <slug> --owner-approved` closes the step
and prints the next one.

## Commands

| Command | What it does |
|---|---|
| `start <slug> [--workflow <name or path>]` | Mint a workstream that follows the given workflow, or resume an existing one, then print the current step. A new workstream needs `--workflow`. |
| `continue <slug> [--artifact <path>]...` | The current step's work is finished: record it and print the next step. Refused unless every artifact the step declares (and every `--artifact`) exists and its check command exits 0. |
| `continue <slug> --owner-approved [--note <text>]` | The owner approved the current step, which awaited the owner or was blocked: record it and print the next step. |
| `status <slug>` | Show every step's status, fix cycles and artifacts, and mark the current step. |

Exit codes: 0 success, 1 refused (the reason is printed), 64 usage error.

## Files

- A workflow is a YAML file listing steps, in order, with their gates. The fields are described at
  the top of [`workflows/_k-full-sdlc.yml`](workflows/_k-full-sdlc.yml). Each workstream records the
  workflow it follows, so workstreams in one repository can follow different workflows.
  - `--workflow` takes a path or a name. A reference that contains a slash or ends in `.yml` or
    `.yaml` is a path, and is recorded as an absolute path.
  - A name is looked up as `<name>.yml` in the project's `.konductor/workflows/`, then in
    `~/.konductor/workflows/`, then in the workflows that ship with fuse-flow in
    [`workflows/`](workflows/). A team adds its own workflows to the first or second directory.
  - fuse-flow reads the workflow again on every command, so an edit takes effect straight away, and
    a step added to it is pending.
- `.konductor/workstreams/<slug>.yml` is the state of one workstream: the workflow it follows, and
  each step's status, fix cycles, recorded artifacts and a timestamped history. Only fuse-flow writes
  it. The directory has its own `.gitignore`, so the state stays private to your checkout.

## Rules

- **Order.** Steps run one at a time, in file order. The current step is the first step that is not
  done. There is no parallel execution and the workflow format has no way to ask for it. A step's
  `depends_on` names the earlier steps whose output it builds on, and `depends_on: []` says a step
  builds on none of them; fuse-flow checks that the names point at earlier steps and otherwise
  leaves the field to the reader. Two steps that do not depend on each other still run in the order
  they are listed.
- **Statuses.** `pending`, then `done`. A step with `gate: owner` goes to `awaiting-owner` first.
  `continue` finishes a pending step; `continue --owner-approved` closes a step that awaits the
  owner or is blocked.
- **Fix cycles.** A `continue` refused because an artifact is missing or the check failed costs the
  step one fix cycle. After `max_fix_cycles` of them the step is `blocked`, and only the owner can
  release it with `continue --owner-approved`.
- **Skills.** A relative skill path is looked up in `FUSE_SKILLS_DIR`, then `skills/`,
  `.kiro/skills/`, `.konductor/skills/`, `.claude/skills/` and `.agents/skills/` in the
  repository, then `SKILLS_HOME`, then `~/.kiro/skills/`, `~/.konductor/skills/`,
  `~/.claude/skills/`, `~/.codex/skills/`, `~/.config/opencode/skills/` and `~/.agents/skills/`.
- **Running at the same time.** A check command runs outside the lock on the state file, so a long
  test run does not hold up other workstreams. If two `continue` commands for the same workstream
  run at once, both run the check, and only the first to finish records the step; the other is
  refused without costing a fix cycle.

## What fuse-flow does not try to do

fuse-flow tracks one engineer's workstream on their own machine. It is not a security boundary, and
`continue` is deliberately one input with no step id:

- `continue` acts on whatever step is current when it runs. Run it once per step. If a `continue`
  that already succeeded is run again, it acts on the following step: it is refused when that
  step's artifacts are missing (which costs that step a fix cycle), and it marks the step done when
  the step declares no artifacts and no check. `continue --owner-approved` run again is refused
  unless the following step already awaits the owner. Every `continue` prints what it recorded,
  and the state file's history keeps the timestamps, so a replay is visible.
- A `check:` command runs like a Makefile target, from the repository root with your environment.
  Only use workflow files you trust.
- `continue --owner-approved` records the owner's word. It does not verify who typed it; the agent
  is instructed to run it only after the owner has approved.
- Skill and artifact paths are taken as written, including absolute paths and paths outside the
  repository.

## Code

| File | Contents |
|---|---|
| `src/cli.ts` | Argument parsing, printing, exit codes. |
| `src/commands.ts` | The three commands. Start here. |
| `src/workflow.ts` | The workflow file: its format and validation. |
| `src/workstream.ts` | The state file: its format, reading, and locked updates. |
| `src/project.ts` | The repository root, the workflow and skill lookup, and the paths under `.konductor/`. |
| `src/errors.ts` | The two error types, mapped to exit codes 1 and 64. |
| `fuse-flow` | Shell script that runs `src/cli.ts` from any directory, with Bun or else Node. |

Tests: `bun test` in this directory. Each test runs the real command line in a throwaway repository.
