# fuse-konductor

fuse-konductor guides a workstream through an ordered workflow. `fuse-flow` tracks each step and
prints the work to do next. Do the step with the owner; let fuse-flow decide the order.

Each workstream's state is saved in `.konductor/workstreams/<slug>.yml` in the project repository.

The fuse-konductor clone is at {{CLONE}}. `fuse-flow` is `fuse/flow/fuse-flow` in that clone. Run
it by its full path from the root of the user's project repository, never from inside the clone.
Workstream state and everything the steps produce belong in the project repository. Workflows are
the `*.yml` files under `fuse/flow/workflows/` in the clone; each has a name and description.
fuse-flow needs Bun and installs its own dependencies on first use. If Bun is missing, tell the
user to install it from https://bun.sh. If the clone is not at the path above, ask the user for its
location.

## When to use it

- If the user asks to work with konductor, fuse or fuse-konductor, follow these rules.
- If the user asks to continue substantial work that may already be in progress, or to start a new
  feature, system or other large workstream, suggest a suitable fuse-konductor workflow. The user
  decides. If they decline, do not suggest it again for that work.
- Otherwise, do not bring it up.

## Pick up or start a workstream

1. List `.konductor/workstreams/*.yml` in the repository and run `fuse-flow status <slug>` for
   each existing workstream. If one matches the user's request, or the user names one, continue it.
   If several may match, ask which one.
2. For new work, offer the workflows with their descriptions. Recommend one when the request gives
   enough information, but start only after the user agrees.
3. Pick a short lower-case slug, such as `checkout-redesign`, and run
   `fuse-flow start <slug> --workflow <workflow name or path>`.

## Run the workflow

1. Run `fuse-flow start <slug>` to print the current step.
2. Follow the complete step block it prints. `STEP` gives the instruction. `CONDITION` says when
   an optional step applies. `READ` names inputs. `PRODUCE`, `PRODUCE (optional)` and `UPDATE`
   name artifacts. `WHEN THE WORK IS DONE` gives the checks, review and exact continuation command.
3. Do the work, including the artifact guides and templates named in the block. Run the checks and
   independent review in the printed order. Account for every artifact with the printed
   `--updated`, `--unchanged` and `--not-produced` flags.
4. Run the printed continuation command. If fuse-flow prints `REFUSED`, fix or account for what it
   names and follow the repeated step block. Repeat until it prints an `OWNER'S TURN` block or the
   workflow completes.

Never run `--from`, `--forward-to`, `--back-to`, or `--skip` on a step without a condition unless
the owner explicitly asked for that jump or skip. If a jump would help, recommend it with a reason
and wait. Run the command only after the owner decides. After any jump, follow the new step's
`READ` lines. Recover missing artifacts in the way that best serves the owner, such as extracting
relevant content from related work or writing a clear placeholder, and report what you did.

When fuse-flow prints an `OWNER'S TURN` block, fill in every placeholder, preserve its line order,
and end the message with that block. Put the recommended owner option first and explain why. The
commands printed after the block are for you: do not copy them into your message. Run an
owner-decision command only after the owner has decided.

Every other hand-back to the owner also ends with exactly these five labelled lines:

`SUMMARY:` State the task, workstream slug, and current step with its position.
`STATUS:` Use exactly one of the five values below.
`PRODUCED:` List new or updated files and justified omissions. Summarize five or more files.
`VERIFICATION:` Give check results, review rounds used of the cap, and required fixes still open;
use `none` when there were no gates.
`NEXT STEP:` Give two to four owner options, with the recommendation first and its reason.

The five status values are:

- `awaiting owner action`: the step's work is done and an owner action waits.
- `blocked`: the planned path broke down and the owner must decide how to proceed.
- `needs input`: work remains in progress, but an owner answer or decision is needed.
- `paused`: work remains in progress and needs only the owner's request to continue.
- `workflow complete`: every step is completed or skipped.

For `awaiting owner action`, `blocked`, and `workflow complete`, fill in the hand-over block that
fuse-flow prints. For `needs input` and `paused`, run `fuse-flow status <slug>` and write the whole
five-line block from the current state. Include every skipped step and its reason where relevant.

The state is saved after every command. A later session resumes by running
`fuse-flow start <slug>`.

## Writing for the owner

The owner reads what you write without the context you have built up. Write every statement so
that it explains itself to that reader.

- A heading, list entry or decision names its subject in words, such as "Matching rule: which free
  slot a booking request gets". A label such as `D1`, `Q3`, `P1` or `round 3` may accompany the
  words but never replaces them, in a document, a hand-over or a commit message.
- Refer only to what the reader has just read. A label defined in the text closely above may be
  reused. Do not point at a decision further down the document, in another file, or in the
  conversation; say what it is instead.
- Write commit subjects that describe the change on their own terms, without plan, task, finding
  or review-round identifiers.
- Keep fuse-flow behind the scenes. Name the next step, phase or artifact in plain words, such as
  "next, the code review". Do not show fuse-flow commands, flags or the workstream's state file,
  and do not assume the owner knows how fuse-flow works. When the owner asks how it works,
  explain it.
