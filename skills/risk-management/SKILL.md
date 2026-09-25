---
name: risk-management
description: Use when starting a risk assessment, updating a RAID log, or when a program's risks need to be identified and tracked. Assesses risks and records mitigation plans.
version: 1.0.0
tags: [skill, tpm, risk, mitigation, raid, assessment]
---

# Risk Management

## Overview

Creates and maintains RAID logs (Risks, Assumptions, Issues, Dependencies) with probability × impact scoring, mitigation strategies, risk owners, and escalation criteria. Use at program start for initial assessment or ongoing for RAID log updates.

## Usage

Use this skill when:

- Starting a new program and need initial risk assessment
- Updating the RAID log during sprint reviews or milestone gates
- A new risk has been identified and needs formal documentation
- Preparing risk summaries for leadership escalation

## Core Concepts

### RAID Log Format

- **Risks** — uncertain events that may impact the program (probability × impact)
- **Assumptions** — conditions believed true but not yet validated
- **Issues** — risks that have materialized and need resolution now
- **Dependencies** — external factors the program relies on

### Probability × Impact Scoring

Rate each: **Probability** (High >70%, Medium 30-70%, Low <30%) and **Impact** (High: schedule slip >2w or scope cut, Medium: 1-2w slip or workaround needed, Low: <1w slip, absorbed). Combined score determines priority: H×H = Critical, H×M or M×H = High, H×L or L×H or M×M = Medium, all others = Low.

### Mitigation Strategies

Each risk gets one of: **Avoid** (eliminate the cause), **Mitigate** (reduce probability or impact), **Transfer** (shift to another party), **Accept** (acknowledge with contingency plan). Every mitigation has an owner and a trigger condition.

### Escalation Criteria

Escalate when: risk score increases to Critical, mitigation fails, issue unresolved past due date, or dependency at risk of not being met. Escalation path: TPM → Program Lead → Director → VP.

## Output Format

1. **RAID Log Table** — columns: ID, Type (R/A/I/D), Description, Probability, Impact, Score, Mitigation, Owner, Due Date, Status (Open/Mitigated/Closed/Escalated)
2. **Risk Heat Map** — 3×3 grid (Probability vs Impact) with risk IDs plotted
3. **Top 5 Risks Summary** — one-liner per risk with mitigation status for executive reporting
4. **Review Cadence** — recommended review frequency: Critical (weekly), High (bi-weekly), Medium (monthly), Low (quarterly)
5. **Escalation Log** — any risks escalated this period with path and outcome

## Quality Gate

**CRITICAL (must fix):**

- Risk without probability or impact score
- No mitigation strategy for High or Critical risks
- Issue without owner or due date
- Dependency with no contingency if unmet

**IMPORTANT (should fix):**

- Assumptions not validated or missing validation plan
- No escalation criteria defined for Critical risks
- RAID log missing review cadence

**SUGGESTION:**

- Could add risk velocity (new risks per sprint) as a trend metric
- Could link risks to specific milestones in the program plan

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
