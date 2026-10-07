# fuse-flow: rules for sending work back

Status: brainstorming draft. Nothing here is implemented.

## Agent decision to approve or decline

**Keep "approved" for a step without an owner gate; drop the proposed "done" status.** The owner
pointed out that "approved" is intentional: it means the step's gates passed, whoever ran them
(the owner, a reviewing agent, or the authoring agent after its checks). The decently-fancy-designs
log shows no harm from it. Every owner approval the agent asked for came from the requirements
step's owner gate or from the prototype step's instruction text, never from an artifact's status.
The only real problem was the contradiction in the status view: intake had recorded the
requirements as approved while the file's own status line said draft, and after the send-back
the view showed both. The rule on one status per artifact below removes that on its own. The
engine's help text for `status` gets one sentence on what "approved" means, so no reader takes it
for an owner's approval.

Last reviewed against: the owner's agreement to per-pass round counting and to an owner gate on
the prototype step, both folded into the rules below.

## Background

The decently-fancy-designs workstream was sent back from the prototype step to the requirements
step on 2026-10-07. The agent's usage log for that turn records five surprises:

1. The send-back was refused, because the prototype step was in progress and had no owner gate.
   The agent marked the step blocked to get past the check, so its history records a block that
   never happened.
2. The status view lists the requirements file twice: approved under intake, draft under
   requirements.
3. The prototype step is pending again with no outputs, so its three research notes no longer
   appear anywhere in the workstream.
4. The requirements review gate caps rounds at 2, but nothing says whether rounds from the
   earlier pass count. The findings files continued at round 3.
5. The send-back message tells the agent to reset the file's status "as its guide says", but the
   requirements artifact has no guide.

The owner found a sixth problem after approving the second pass of the requirements:

6. The prototype step was handed out again as if it had never run. Nothing in the step block or
   the status pointed to the prototypes and research notes from the first pass, so the agent had
   no record of what was already settled. Three things in the engine and the workflow add up to
   this. The prototype step was in progress, so its outputs were never recorded. Its artifact is
   the folder `docs/research/`, and even a completed step records only that folder, not the
   notes inside it, which are shared with other work. And the system-design step consumes only
   the requirements, so it is never told about the research notes either.

## Proposed rules

### Rule on who can send work back, and from where

The owner can send work back from the current step whatever its status: pending, in progress,
awaiting the owner or blocked. The target is the current step or an earlier one. Going back is
already an owner-only command, so a status check adds no protection; jumping forward already
accepts the same four statuses, and the two directions should match.

This fixes the first surprise. The agent no longer records a false block.

### Rule on the work a step had already done

A send-back records what the current step had written so far. The send-back command accepts the
same list of updated files that finishing a step accepts, and the engine stores them on the step
as draft artifacts.

When a step's artifact is a folder, such as `docs/research/`, the agent names the files it wrote
in that folder, and the engine records each file. The folder alone does not say which notes
belong to this workstream.

Reopening a step keeps its artifact records, marked as draft, instead of losing them. This holds
for the step the work was sent back from and for every completed step between it and the target.
When the engine hands a reopened step out again, the step block lists those files as "written in
an earlier pass" and tells the agent to check each one against what changed since: keep it,
update it, or redo it, and propose to the owner which. For the prototype step that means the
agent says which experiments still answer their question under the new requirements, and runs
again only the ones that do not.

This fixes the third and sixth surprises.

### Rule on one status per artifact

Each artifact path has one current status in the status view. The view lists the path once,
under the latest step in workflow order that records it, with that step's status. Earlier steps
keep their records for the history, and the view notes "also produced by intake" where that
helps the reader.

"Approved" keeps its meaning: the step's gates passed, whoever ran them. A step without an owner
gate still marks its artifacts approved when it completes.

This fixes the second surprise.

### Rule on review rounds after a send-back

A gate's cap counts the rounds of the current pass; the owner agreed to this on 2026-10-07.
Counting across passes would stop a step at its first review after a send-back whenever the
earlier pass used its rounds, which is when the owner most wants a fresh review. A pass starts when a step is handed out for
the first time, and again each time a send-back reopens it. Rounds the owner granted belong to
their pass and lapse with it, as they do today.

The findings files carry the pass in their name, for example
`requirements-pass-2-round-1.json`, so a file name alone says which pass and round it records,
and the rounds used are simply the files of the current pass. The alternative is to keep one
running round number and have the step block say "this pass starts at round 3; the cap allows
rounds 3 and 4". That keeps today's names but makes every reader do the arithmetic.

After a send-back, the step block says that the review covers the whole artifact, and that the
reviewer gets the earlier passes' findings files with how each finding was handled. The review
guide `review.md` gets the same two sentences, so a reviewer launched without the step block
follows them too.

The debug-mode guide, `skills/fuse-workstream/debug-mode.md`, is already wrong here. It was
committed in `da680e5` before this rule existed, and it counts rounds used as the number of
findings files for the step and gate. After a send-back that count includes the earlier passes,
so for decently-fancy-designs the report would show the requirements gate at its cap of 2 before
this pass's first review has run. The guide
changes to count only the current pass's rounds against that pass's cap: the files named for the
current pass, or, under the running-number alternative, the rounds from the number the step block
names.

This fixes the fourth surprise.

### Rule on resetting a file's own status line

Messages about an artifact's status mention a guide only when the artifact has one. Otherwise the
message says: "If the file itself records a status, such as a 'Status: approved' line, set it back
to draft." The approval message gets the same treatment.

This fixes the fifth surprise.

## Workflow changes that go with the rules

The prototype step in `fuse-system-development.yml` gets an owner gate, which the owner agreed to
on 2026-10-07: "approve the prototype findings, or send the work back to the requirements". Its
instruction already asks the owner to agree to experiments, and a prototype that changes the
requirements is a normal result, so the gate gives the owner one defined point to decide.

The system-design step consumes the research notes as well as the requirements, so its step
block lists the prototype results its instruction already tells the agent to cite. The research
notes are an optional input there, since the prototype step runs only when its condition holds.

This also answers why the agent asked the owner to approve experiments in a step without a gate:
the approval lives in the step's instruction text, so the engine never sees it. Any owner decision
a workflow relies on belongs in a gate, where the engine can record it.

## Testing

Each rule gets an end-to-end fuse-flow test that reproduces its surprise from the
decently-fancy-designs workstream and fails against the current engine.
