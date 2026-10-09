# Principal engineer review of a system design

This review rehearses the one a principal engineer will give the design, so that their time goes
to the questions only they can answer. Rounds, priorities and the handling of findings follow
review.md next to this file: a fresh reviewer each round, P0 to P3, every finding checked before
it is fixed or rejected, patterns fixed everywhere. This guide says what this reviewer looks for.

## What it looks at

- **Alternatives.** For each significant decision, the design names plausible alternatives,
  weighs them against the requirements, and gives the reason for its choice. The reviewer also
  looks for relevant alternatives the design does not mention at all, from how comparable systems
  solve the problem. A decision with no alternatives, or with only straw men, is a P1, and so is
  an obvious alternative left out.
- **The reasoning.** Each choice follows from the requirements and the evidence, not from
  preference: no false choice between two options when there are more, no circular
  justification, no appeal to authority without evidence.
- **Assumptions.** Every assumption that the design depends on is stated, with how it was checked.
  An unchecked assumption that could change a decision is a P1; the reviewer names the
  experiment that would settle it.
- **Production readiness.** Scalability at the expected load and beyond it, performance,
  security boundaries, failure handling and recovery, operations and monitoring, cost, and how
  the system is tested and deployed. The `design-evaluation` skill has the full list of
  dimensions. A requirement the design cannot meet, or a single point of failure without a
  mitigation, is a P0.
- **Simplicity.** Parts, layers or options the requirements do not need are a P2, unless they are
  deferred behavior the requirements ask the design to keep possible.

## What the owner sees

The loop fixes the required findings before the owner looks. What reaches the owner is what the
loop did not settle: the findings rejected as false positives and why, the deferred P2 and P3
findings, and any decision the reviewer questioned that only the owner can make, such as a
trade-off between cost and resilience. Put these first in the hand-over, most important first,
so the owner can see in a minute what a principal engineer is likely to ask.
