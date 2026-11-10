# kiro-requirements-generation fixture key

docs/stories/csv-export.md (p3):
- Vague terms to replace with measurable values: "quickly", "many rows", "it is blocked".
- US-1 "Given filters, When Export, Then downloads" -> Complex (WHILE ..., WHEN ..., THE ... SHALL). "Then the CSV includes all visible columns" -> Ubiquitous.
- US-2 "Given many rows, When Export, Then background job" -> Complex with a concrete row threshold. "Given the export job fails, Then notification" (Given+Then, failure) -> Unwanted (IF ..., THEN THE ... SHALL).
- US-3 "Given lacks permission, When Export, Then blocked" is Given+When+Then -> the skill's rule gives Complex; Unwanted (IF ... THEN) is also acceptable. Should add a concrete outcome (403 / no file generated / audit).
- Assumptions should be stated in the Introduction.

docs/handoff/sprint-14-stories.md (p2):
- Two epics. Only "Billing Alerts" (BA-1, BA-2) is in scope for spec_dir out/specs/billing-alerts/. Budget Management (BM-1, BM-2) belongs to a different feature: the skill says filter to the in-scope feature and write exactly one requirements.md. Mentioning BM as out of scope in the Introduction is fine.
- BA-1 "Given the email provider is down, Then retried" -> Unwanted with a concrete retry policy (count/backoff).
- "Then each budget alert is sent at most once per threshold per month" and "Then thresholds are configurable per account" -> Ubiquitous (THE ... SHALL).
- Nothing should be written under .kiro/specs.
