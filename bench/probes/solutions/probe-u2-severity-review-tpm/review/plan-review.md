# Review of docs/program-plan.md

No files were changed.

## Findings

### 1. Go-live is dated before the security sign-off it depends on

Severity: critical

M4 Go-live is 2025-07-01 and depends on M3. M3 Security sign-off is 15 July 2025. The plan contradicts itself, and go-live cannot happen on the stated date.
Action: move M4 to after M3, or bring M3 forward and say how.

### 2. The vendor dependency has no owner and no date

Severity: important

M2 needs vendor API v2, which is promised "in the second quarter". Nobody owns the follow-up, and M3 and M4 depend on M2. Risk R1 lists "none yet" as its mitigation.
Action: name an owner, ask for a firm date, and write a fallback.

### 3. The budget does not add up

Severity: important

The four lines (220,000, 90,000, 55,000 and 45,000) sum to 410,000, but the total approved is 380,000. Either a line or the total is wrong.
Action: correct the table and confirm the approved figure with finance.

### 4. Two date formats

Severity: suggestion

Dates appear as `2025-06-20` and as `15 July 2025`. Use one format.

### 5. The status colours are not defined

Severity: suggestion

The plan says workstreams are reported as G, A or R but never says what each colour means.
Action: add a short legend with the thresholds.
