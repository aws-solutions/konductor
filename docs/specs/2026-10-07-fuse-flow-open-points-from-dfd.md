# fuse-flow: open points from the decently-fancy-designs run

Status: brainstorming draft. Nothing here is implemented.

## Needs your decision

1. **At the review round cap, does the agent still fix the last round's findings before it
   reports the step blocked?** I recommend yes: fix, then block, and say in the hand-over that
   these fixes are unreviewed. The other way, blocking before the fixes, shows the owner the
   reviewed state, but throws away work the owner will usually want anyway, and the owner then
   has to ask for the fixes as a separate turn. The step block and `review.md` say the same,
   whichever way you decide.
2. **When the owner accepts a step blocked at one gate, do the step's later gates still run?**
   I recommend that they do by default: "accept this review as it is" records the owner's
   acceptance of that gate and hands the step back to the agent for the gates still ahead, such
   as the principal review. Accepting the whole step, with the later gates skipped, stays
   possible, and the option names the gates it skips. Today only the second exists, and the
   hand-over does not say that gates are skipped.

## Agent decisions to approve or decline

- **A blocked step records what it produced.** `--blocked` records the step's produced files
  that exist, as draft, and accepts `--updated` the way a send-back now does, so the hand-over no
  longer says "PRODUCED: none" for a step that wrote the design.
- **The reviewer launch is printed for the agent's own model.** When the reviewers table gives
  the agent's model its own launch, the step block prints that launch alone, instead of "unless
  its row says otherwise, start the reviewer as a fresh subagent" followed by the row's command.
  The reader no longer has to work out which of the two applies.
- **A launch command must return once the findings are written.** The policy schema and the
  review guide say so in one sentence each. decently-fancy-designs needed a wrapper script,
  `.konductor/opencode-review.sh`, because `opencode run` does not always exit after writing the
  findings. A generalised copy ships as an example next to the policy schema, with OpenCode as
  the case it was written for.
- **An install records where it came from.** `install.sh` writes the clone's commit, besides its
  path, into the install manifest, and prints "installed from <clone> at <commit>". An agent or
  the owner can then tell which version of the workflows a project runs. In the run, the clone
  pointer named an agent worktree four commits behind `fuse`, and a reinstall from it changed
  nothing without saying why.

## Background

The decently-fancy-designs workstream follows `fuse-system-development` with fuse debug mode on,
so its log at `.konductor/debug/fancy-designs.md` in that project records each turn's surprises.
Most of them are fixed on `fuse`: the send-back rules, the rule that a step instruction wins over
an artifact guide, and the debug-mode corrections. This spec covers the ones that are not.

### Surprises from the system-design review

The system-design step has two agent review gates, the design review and a principal review,
each with a round cap. The design review reached its cap of two rounds, each ending with
required fixes.

1. **The fix pass at the cap.** The step block says that after two such rounds the agent starts
   no further review and reports the step blocked. It does not say whether the second round's
   fixes still happen. `review.md` defines a round as one review followed by one pass of fixes,
   so the agent ran the fixes, and the owner now decides on a draft whose last changes nobody
   reviewed. The first decision above settles this.
2. **Accepting skips the principal review without saying so.** The blocked hand-over offers
   "accept the step as it is". Accepting completes the step, so the principal review gate never
   runs. The second decision above settles this.
3. **"PRODUCED: none" on a blocked step.** fuse-flow records a step's artifacts only when the
   step finishes, and reporting it blocked records nothing. The agent decision on blocked steps
   settles this.
4. **The launch wording.** The review request said "start the reviewer as a fresh subagent in
   your own harness, unless its row says otherwise" and also printed the launch command for the
   agent's model. It worked, but the agent had to infer that the command was the row's override.
   The agent decision on the reviewer launch settles this.

### Surprises from earlier turns

5. **The launch command did not return.** Nothing says a launch command must return once the
   findings file is written, so the project had to write a script that watches for the findings
   and stops OpenCode. The agent decision on launch commands settles this.
6. **Which clone a project was installed from.** The machine-wide pointer named an outdated agent
   worktree, and nothing in the project showed which clone or version it used. The agent decision
   on installs settles this.

## Left as they are

- **Answering the design's open questions when granting rounds.** The owner can answer in the
  note that goes with granting more rounds. A separate field would formalise the same thing.
- **Intake's draft requirements show as approved** while the requirements step runs, until that
  step records the file. Under the meaning of approved that the owner confirmed (the step's gates
  passed, whoever ran them), this is correct.
- **The prototype step has no agent review.** Its conclusions are checked by the new owner gate,
  and later by the design review. An agent review gate there would add cost to every prototype
  for a check that already happens.
- **Earlier custom report rules.** The debug-mode guide does not say what to do with a project's
  own earlier report rules or a log kept elsewhere. That was a one-time migration in this project.

## Testing

Each engine change gets an end-to-end fuse-flow test that reproduces its surprise and fails
against the current engine: accepting a blocked step with a later gate, the PRODUCED line of a
blocked step, the printed launch for a model with its own row, and the installer's record of the
clone's commit.
