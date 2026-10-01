# fuse-konductor

fuse-konductor guides a workstream through a workflow of steps. A small state machine,
`fuse-flow`, tracks where each workstream stands and tells you what to do next. You do the work
of each step with the user; `fuse-flow` decides the order.

Each workstream's state is saved in `.konductor/workstreams/<slug>.yml` in the user's
repository.

The fuse-konductor clone is at {{CLONE}}. `fuse-flow` is `fuse/flow/fuse-flow` in the clone; run it
by its full path. The workflows are the `*.yml` files in `fuse/flow/workflows/` in the clone; each
has a `name` and a `description`. `fuse-flow` needs Bun and installs its own dependencies on first
use. If Bun is missing, tell the user to install it from https://bun.sh. If the clone is not where
this says, ask the user where it is.

## When to use it

- The user says they want to work with konductor, fuse or fuse-konductor: follow the steps
  below.
- The user asks to continue work that may be in progress, or to start a new feature, system or
  other large piece of work: suggest a fuse-konductor workflow. The user decides. If they decline,
  do not suggest it again for this work.
- Otherwise, do not bring it up.

## Pick up or start a workstream

1. Check for work in progress. List `.konductor/workstreams/*.yml` in the repository and run
   `fuse-flow status <slug>` for each. If one matches what the user is talking about, or the user
   names one, continue it: go to "Run the workflow". If it is unclear, ask the user.
2. For new work, choose a workflow. Offer the workflows with their descriptions. If
   you already know enough about what the user wants, recommend one and say why. Start only after
   the user agrees.
3. Pick a short slug for the workstream, such as `checkout-redesign`, and run
   `fuse-flow start <slug> --workflow <workflow file>`.

## Run the workflow

1. `fuse-flow start <slug>` prints the current step: the skill to read, the instruction, the
   artifacts to produce, the gate, and the `continue` command.
2. Read the skill. Guide the user through the step as the instruction says.
3. When the step is finished, run the `continue` command it printed. It checks the step, records
   it, and prints the next step. If it is refused, fix what it names and try again.
4. Repeat from 2 until `continue` prints `workflow complete`.

If the printed step awaits the owner, or is blocked, show the user the artifacts and stop. Run
`fuse-flow continue <slug> --owner-approved` only after the user has approved.

The state is saved after every command. A new session can continue the workstream at any time.
