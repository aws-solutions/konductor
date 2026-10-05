# Review in the fuse development workflows

A review round is one independent review of the whole artifact, followed by one pass of fixes.
The goal is that the owner only sees work that an agent has already tried hard to break.

## The reviewer

Use a fresh agent that has none of this session's context, on the most capable model you can
start, preferably from a different model family than the author's. Give it the artifact, what the
artifact must satisfy (the owner's request, the approved requirements or spec), and read access to
the repository. Do not tell it what you expect it to find. If the harness cannot start another
agent, review the artifact yourself in a separate pass and say so in the hand-over.

## What it looks at

- A document: is it correct, complete for its purpose, and consistent with itself and with what
  it builds on? Is every claim about existing code or services true when checked against the
  source? Could the next step be done from it without guessing?
- Code: the whole diff since the branch started, against the approved spec. Behavior the spec
  asks for that is missing or wrong, tests that do not prove what they claim, security and data
  loss risks, and departures from the project's conventions. Check the tests against the spec,
  not only the code: each behavior the spec requires has a test that would fail without it, and
  no test was weakened or narrowed to pass. A required behavior without such a test is a P1.

## Priorities

- P0: wrong or unsafe; it would lose data, break users, or open a security hole.
- P1: a requirement is missed, or a defect a user would hit.
- P2: worth fixing, but nobody is hurt if it waits.
- P3: a nit.

P0 and P1 findings are required fixes. Check each one against the code before you accept or
reject it, and record a rejected finding as a false positive with the reason. Fix P2 and P3
findings when the fix is cheap; list the rest as deferred in the hand-over.

## A round

Fix every required finding in one pass. In code, start each fix with a test that fails because
of the finding. Run the checks, then start the next round with a fresh reviewer on the whole
artifact again, told how each earlier finding was handled. A round passes when it leaves no P0 or
P1 open. When the round cap is reached with required fixes open, stop and report the step as
blocked with the open findings; the owner decides.

In the hand-over, list each round's findings with how each was handled, and the deferred ones.
