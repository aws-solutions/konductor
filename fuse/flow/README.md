# fuse-flow

fuse-flow keeps track of where a workstream stands in a workflow, so that an agent does not have to
reason about it. The agent asks `fuse-flow next` what to do, does it, and reports back with
`fuse-flow done`. fuse-flow decides which step comes next, refuses a step whose artifacts are missing
or whose check fails, and holds a step until the owner approves it.

It is a small command line tool. It runs the TypeScript sources directly, with no build step, on
[Bun](https://bun.sh) or on Node 22.18+, 23.6+ or 24+. Bun is the main runtime and runs the tests. fuse-flow
is not part of the installed Konductor package yet; `synth` and `install` do not ship it.

```bash
cd fuse/flow && bun install              # once, for zod and yaml; with Node: npm install --no-package-lock
cd <your-project>
<this-checkout>/fuse/flow/fuse-flow start my-feature --workflow _k-full-sdlc
```

In normal use you do not type these commands. You ask the agent to start a new feature, and the
agent runs them. Konductor will deliver `AGENTS.md` rules that tell the agent to do so; those rules
are not written yet. The agent runs the `fuse-flow` script by its full path, and every follow-up
command fuse-flow prints uses that same path, so nothing needs to be on `PATH`. The rest of this
document writes the commands as `fuse-flow ...` for short.

## The agent loop

1. `fuse-flow next <slug>` prints one step: the skill file to read, the instruction, the artifacts
   to produce, the gate, and the `done` command to run afterwards.
2. The agent does the work and runs `fuse-flow done <slug> <step>`. When `done` succeeds it prints
   the next step, exactly as `next` would.
3. Repeat step 2 until `done` prints `workflow complete`. `next` is only needed to pick up a
   workstream again, for example in a new session.

When the printed step awaits the owner, or is blocked, the agent shows the owner the artifacts and
stops. After the owner has said yes, `fuse-flow gate <slug> <step> --owner-approved` closes the step
and, like `done`, prints the next one.

## Commands

| Command | What it does |
|---|---|
| `start <slug> [--workflow <name or path>]` | Mint a workstream that follows the given workflow, or resume an existing one. A new workstream needs `--workflow`. |
| `next <slug>` | Print what to do for the next step, or `workflow complete`. |
| `done <slug> <step> [--artifact <path>]...` | Record a pending step as finished, then print the next step. Refused unless every artifact the step declares (and every `--artifact`) exists and its check command exits 0. |
| `gate <slug> <step> --owner-approved [--note <text>]` | Record the owner's approval of a step that awaits it, or the owner's decision to accept a blocked step as it is, then print the next step. |
| `status <slug>` | Show every step's status, fix cycles, artifacts and unmet dependencies. |

Exit codes: 0 success, 1 refused (the reason is printed), 64 usage error.

## Files

- A workflow is a YAML file listing steps, their order, and their gates. The fields are described at
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

- **Order.** A step runs after the steps in its `depends_on`, or after the step listed before it
  when `depends_on` is omitted. A step can only depend on steps listed before it, so the file order
  is always a valid order. `next` offers the first step in file order that is not done and whose
  dependencies are done. Steps that do not depend on each other can be finished in any order, but
  `next` hands out one step at a time.
- **Statuses.** `pending`, then `done`. A step with `gate: owner` goes to `awaiting-owner` first.
  `done` is accepted only for a pending step whose dependencies are done.
- **Fix cycles.** A `done` refused because an artifact is missing or the check failed costs the
  step one fix cycle. After `max_fix_cycles` of them the step is `blocked`, and only the owner can
  release it with `gate`.
- **Skills.** A relative skill path is looked up in `FUSE_SKILLS_DIR`, then `skills/`,
  `.kiro/skills/`, `.konductor/skills/`, `.claude/skills/` and `.agents/skills/` in the
  repository, then `SKILLS_HOME`, then `~/.kiro/skills/`, `~/.konductor/skills/`,
  `~/.claude/skills/`, `~/.codex/skills/`, `~/.config/opencode/skills/` and `~/.agents/skills/`.
- **Running at the same time.** A check command runs outside the lock on the state file, so a long
  test run does not hold up `done` for another step. If two `done` commands for the same step run at
  once, both run its check, and only the first to finish records the step; the other is refused
  without costing a fix cycle.

## What fuse-flow does not try to do

fuse-flow tracks one engineer's workstream on their own machine. It is not a security boundary:

- A `check:` command runs like a Makefile target, from the repository root with your environment.
  Only use workflow files you trust.
- `gate --owner-approved` records the owner's word. It does not verify who typed it; the agent is
  instructed to run it only after the owner has approved.
- Skill and artifact paths are taken as written, including absolute paths and paths outside the
  repository.

## Code

| File | Contents |
|---|---|
| `src/cli.ts` | Argument parsing, printing, exit codes. |
| `src/commands.ts` | The five commands. Start here. |
| `src/workflow.ts` | The workflow file: its format, validation and step order. |
| `src/workstream.ts` | The state file: its format, reading, and locked updates. |
| `src/project.ts` | The repository root, the workflow and skill lookup, and the paths under `.konductor/`. |
| `src/errors.ts` | The two error types, mapped to exit codes 1 and 64. |
| `fuse-flow` | Shell script that runs `src/cli.ts` from any directory, with Bun or else Node. |

Tests: `bun test` in this directory. Each test runs the real command line in a throwaway repository.
