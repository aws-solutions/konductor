# Review: notification preferences

This is not ready for wider review yet. The core architecture is coherent and fits the existing outbox, stream, and local-view boundaries, but the document currently mixes a narrow first release with a future policy system and does not consistently carry the product's measurable commitments into its goals and capacity story. Tightening the scope and making the decision record internally consistent would make the next review more productive.

The most serious issue is the policy layer in 4.3. It introduces rules, future conditions, and a new conceptual boundary that the product brief excludes and the team constraints say has no owner or approved operating budget. Remove it from this release and keep the event payload as the fixed four-category map. The document should also connect its stated customer outcome to the 60-second, 99-percent visibility target, and put the launch population and 12-month growth assumption into the capacity subsection rather than leaving the scale claim untestable.

The propagation choice is described twice, in 4.2 and 7.1. Keep the design rationale in 4.2 and have the rollout section cross-reference it while retaining only rollout-specific behavior. Section 6.2 needs a real alternative, such as a shared read service or a batch-synchronized sender view, with effort, cost, latency, and failure-mode comparisons. Finally, 8.3 should be cut or turned into concrete operating commitments with owners and measures. The existing sections 7.2, 7.3, and 8.1 already contain useful operational detail, so the filler is not needed to make the proposal feel complete.

Before sending this to the wider group, also confirm the event contract with Messaging, show how the source version and local version are reconciled after a replay, and state what happens to a customer's saved choice during a paused rollout. Those are useful follow-ups to the main edits, not reasons to broaden the first release.

```json
[
  {
    "location": "2.1",
    "severity": "high",
    "issue": "The customer outcome is phrased as a feeling and omits the product brief's 60-second visibility and 99-percent target, so success cannot be judged from this goal.",
    "fix": "State the measurable 60-second and 99-percent target in this subsection and link it to the success measures."
  },
  {
    "location": "4.3",
    "severity": "critical",
    "issue": "The proposed policy and rules layer adds quiet-hours, ranking, and future condition machinery that the first release explicitly puts out of scope, with no owner or budget.",
    "fix": "Remove the policy layer from this release and use fixed categories and channels; keep future rules out of scope."
  },
  {
    "location": "5.1",
    "severity": "high",
    "issue": "The scale claim has no number or planning horizon, so it cannot be checked against the 10 million launch accounts, current traffic, or 25-percent growth assumption.",
    "fix": "Add the 10 million baseline, observed workload, 25-percent growth, and 12-month planning horizon, then state what capacity decision follows."
  },
  {
    "location": "6.2",
    "severity": "medium",
    "issue": "The only alternative is direct sender reads from the Settings database, which is plainly worse and does not give reviewers a credible comparison.",
    "fix": "Add a credible alternative and compare its latency, cost, operational ownership, and failure behavior with the recommended option."
  },
  {
    "location": "7.1",
    "severity": "medium",
    "issue": "The asynchronous outbox and local-view decision is explained again after 4.2 in different words, creating repetition and two places that could drift.",
    "fix": "Remove the repeated explanation and cross-reference 4.2, leaving only rollout-specific behavior here."
  },
  {
    "location": "8.3",
    "severity": "low",
    "issue": "This long subsection contains general operating advice but no actionable owner, action, measure, or constraint for a reviewer or operator.",
    "fix": "Cut the filler or replace it with a short list of concrete actions, owners, and measures."
  }
]
```