# Design document guide

This is the team's internal writing guide for design proposals.

## Required shape

A proposal states the user and business outcome, measurable goals, non-goals, constraints, design, alternatives, rollout, and operational ownership. A reader should be able to tell what decision is being requested and what evidence would show that the decision worked.

Goals use observable measures. If a product brief supplies a target, the design carries that target forward rather than replacing it with a feeling or a broad aspiration. Non-goals name adjacent work that the proposal does not undertake.

Alternatives describe options that could reasonably be chosen. An option is not a useful alternative when it is included only to make the selected design look obvious. Each alternative includes its effect on user experience, delivery effort, operating cost, and important risks.

## Numbers and scope

Use a number for every claim about traffic, latency, storage, growth, reliability, or cost. Name the time window and whether the number is a target, an observed value, or an estimate. If the design expects growth, show the current baseline and the planning horizon.

Every section should help a reviewer make or validate a decision. Remove paragraphs that repeat the decision, restate context without a consequence, or describe good intentions without an owner, action, measure, or constraint. A proposal may include background, but background should lead to a choice.

## Review expectations

A design is ready for wider review when its scope agrees with the product request, its assumptions can be checked against current service facts, and its open decisions are visible. The author records the owner for rollout, monitoring, and rollback. A review can still identify implementation details to settle later, but the document must not imply work that the request does not fund.