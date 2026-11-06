# Plan review: event-driven invoice export

Scope: `docs/plan.md`, checked against `docs/context.md`. Nothing was changed.

Rating: 2 out of 5. The goal is clear, but the order of work, the timeline and the ownership do not hold up.

## Critical

### 1. The nightly job is deleted before the new path is proven (tasks 8, 9, 10)

Task 9 removes the nightly job after staging (task 5), while task 8, the month-long reconciliation, is still running. There is no rollback, no parallel run and no cutover step. If the queue output is wrong, the CSV job that finance relies on is already gone. Fix: keep both exports running until the reconciliation matches, add a cutover and rollback task, and delete the nightly job last.

### 2. The 3 week target does not fit the work (whole plan)

The durations add up to 36 days. Tasks 1, 7 and 8 alone are 17 days, which is already more than the 15 working days of 3 weeks. A full month of reconciliation cannot finish inside 3 weeks at all. Fix: draw the dependency chain, find the critical path, and either move the date or cut scope. Say what is in the first release.

## Important

### 3. Load test runs without a staging environment (task 6)

Task 6 depends on task 2 only, but it needs the system deployed to staging (task 5). Fix: make task 6 depend on task 5.

### 4. Month-end volume is not covered (task 6)

The background says volume is about four times normal on the last day of the month, and in March the job finished late. Task 6 uses "the Q3 volumes" and never checks the queue limit of 500 messages a second. Fix: test at month-end volume with headroom and state the expected peak rate.

### 5. Tasks 7 and 8 have no owner, and Dana is overloaded (tasks 2, 3, 6, 7, 8)

Nobody owns the ledger consumer or the reconciliation. Dana has tasks 2, 3 and 6, 12 days of work, and tasks 2 and 3 can start together. Fran is away in week 2 and the plan says only that Fran "helps where needed". Fix: name an owner for every task and level Dana's load.

### 6. Done criteria cannot be checked (tasks 2, 4, 5, 6, 7)

Tasks 2 and 7 have no "done when". The others say "works", "deployed" and "no failures" with no threshold. Fix: write a measurable acceptance for each, for example "99.99 percent of test invoices arrive once, in order, at the month-end rate".

### 7. The reports service is in the goal but in no task (goal, notes)

The goal says to move the reports service to the queue. No task does it, and the data team that owns it is not involved. Fix: add the tasks and an owner, or take it out of the goal.

### 8. Production deploy day breaks the deploy rule (task 10, header)

The plan deploys on Wednesday the 24th. Production deploys happen on Tuesday and Thursday only. Fix: move the deploy to Tuesday the 23rd or Thursday the 25th.

### 9. Undefined references (tasks 4, 6)

"The standard retry settings" and "the Q3 volumes" are not defined. The background says retry settings are set per service (3 retries, 2 seconds). Fix: write the actual values or link the source.

## Minor

### 10. Task 3 is vague (task 3)

"Make the exporter better" has no deliverable and no way to see that it is better, and it depends on nothing. Fix: say what changes and how it is measured, or remove the task.

Verdict: NEEDS FIXES
