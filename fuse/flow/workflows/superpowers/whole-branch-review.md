# Whole-branch review

After the requesting-code-review and executing-plans skills of
[obra/superpowers](https://github.com/obra/superpowers) (MIT).

This is the one fresh context the run pays for. Do not replace it with your own reading of the
diff.

## Dispatching the reviewer

- Use a fresh reviewer on the most capable model available, and name the model explicitly. An
  omitted model inherits the session's, which may not be the most capable. If the harness cannot
  start a reviewer, perform the review yourself as a separate pass, and say in the hand-over that
  it was a self-review, which is weaker.
- Write the review package to one file and give the reviewer its path: the commit list, the stat
  summary and the full diff with context, from the commit the branch started at to HEAD.
- Give the reviewer the spec, the plan with its Review Focus section, and the ledger's ruling and
  deferred-minor lines, so it can weigh the decisions you made and check each review-focus input
  deliberately.
- Do not pre-judge findings. Never tell the reviewer to ignore an issue or to rate it low.

## What counts as a required fix

Grade every finding by its effect on a person using the software if it ships, not by whether the
spec names the input that triggers it. The reviewer's labels are advice; the grade is yours.

- **Critical** and **Important** findings are required fixes.
- **Minor** findings are not. Record each one in the ledger as deferred, and list them in the
  hand-over under "Deferred minors".
- A finding you decide not to fix is a ruling. Record it in the ledger with its reason and what it
  costs if wrong.

## Fixing

Fix all required findings in one pass. For each one, write the test that reproduces it, watch it
fail, make it pass, and run the whole suite. A fix without a test that failed first is not
verified. Then obtain one scoped re-review of the fix diff only, which is the next round.

## When a round passes

A round passes when it leaves no Critical or Important finding open. New findings on code the fix
did not touch go to the ledger as deferred minors; they do not extend the review.

When the review passes, list every ledger line containing `Ruling:` in the hand-over under
"Rulings I made", in order, each with what it costs if wrong. Then delete the plan's ledger
directory; the git history is the record now.
