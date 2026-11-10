# Answer key: program-decision-docs fixture (v2, p3 only)

decision-draft.md planted problems, by the skill's quality gate:
- CRITICAL: no "do nothing" baseline (keep CloudWatch as-is is the obvious one).
- CRITICAL: weights sum to 110% (40+30+25+15), so the weighted totals are not on a valid scale.
- CRITICAL: recommendation (Datadog, 4.15) contradicts the matrix winner (Grafana Cloud, 4.40) with no real rationale ("industry leader").
- CRITICAL: decision record has no decision maker and no date ("Decided: yes").
- IMPORTANT: option C has no pros or cons.
- IMPORTANT: no revisit conditions or expiry date.
- IMPORTANT: stakeholders not identified with DACI (only "Owner: platform team").
- Missing status line (Draft / Under Review / Decided / Superseded) and no "what happens if no decision is made".
- Arithmetic check: with weights normalized to 100% the order is unchanged (B 4.00, A 3.77, C 3.32), so B still wins.
Decoys / not issues: the effort T-shirt sizes and H/M/L risk are present and fine; the context has a real metric (38 minutes).
