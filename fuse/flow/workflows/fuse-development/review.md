# Review in the fuse development workflows

A review round is one independent review of the whole artifact, followed by one pass of fixes.
The goal is that the owner only sees work that an agent has already tried hard to break.

## The reviewer

Use a fresh agent that has none of this session's context. When the step names the reviewer's
model for the model you run on, use it. Otherwise use a model of similar cost from a different
family than yours if your harness offers one, or else your own model; do not pick a more expensive
model than yours unless the owner asks. Start it the way the step says: a subagent in your own
harness by default, or the project's launch command. Give it the artifact, what the artifact must
satisfy (the owner's request, the approved requirements or spec), read access to the repository,
and the path of its findings file. It writes its findings there as JSON, following the schema the
step names, and changes no other file. Do not tell it what you expect it to find. If the harness
cannot start another agent and no launch command is set, review the artifact yourself in a
separate pass and say so in the hand-over.

Run one review of the work, not one for each rule set that asks for it. If another installed
skill or always-on instruction also requires a review here, follow the owner's ruling on which one
runs, or ask the owner when there is none.

## What it looks at

- A document: is it correct, complete for its purpose, and consistent with itself and with what
  it builds on? Is every claim about existing code or services true when checked against the
  source? Could the next step be done from it without guessing? Can a reader without the author's
  context follow every heading and reference, or does one lean on a label, such as `D1`, that is
  only explained further down or elsewhere?
- Code: the branch's whole diff from its merge-base with the integration branch, against the
  approved spec. Behavior the spec asks for that is missing or wrong, tests that do not prove
  what they claim, security and data loss risks, and departures from the project's conventions. Check the tests against the spec,
  not only the code: each behavior the spec requires has a test that would fail without it, and
  no test was weakened or narrowed to pass. A required behavior without such a test is a P1.

## Priorities

- P0: wrong or unsafe; it would lose data, break users, or open a security hole.
- P1: a requirement is missed, or a defect a user would hit.
- P2: worth fixing, but nobody is hurt if it waits.
- P3: a nit.

The reviewer says for each finding whether it is a single instance or a broken pattern.

A reviewer is not an authority: it can be wrong, and it lacks context you have. P0 and P1
findings are required fixes once you have checked them against the code; record a rejected
finding as a false positive with the reason. For a pattern, look for every other occurrence in the
change and fix them in the same pass. Fix P2 and P3
findings when the fix is cheap; list the rest as deferred in the hand-over.

## A round

Fix every required finding in one pass. In code, start each fix with a test that fails because
of the finding. Run the checks, then start the next round with a fresh reviewer on the whole
artifact again, told how each earlier finding was handled. A round passes when it leaves no P0 or
P1 open. When the round cap is reached with required fixes open, stop and report the step as
blocked with the open findings; the owner decides.

In the hand-over, list each round's findings with how each was handled, and the deferred ones.

After the owner sends the work back to a step, its next pass starts the round count again, and
its findings files carry the pass in their name. The review still covers the whole artifact, and
the reviewer gets the findings files of the earlier passes, with how each finding was handled.
