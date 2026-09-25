---
name: status-reporting
description: 'Use when stakeholders need a program status report: a weekly update, an executive summary, or a milestone review. Generates an executive or detailed report with RAG status per workstream, accomplishments, milestones, blockers, and action items.'
version: 1.0.0
tags: [skill, tpm, status, reporting, stakeholder, executive]
---

# Status Reporting

## Overview

Generates program status reports in two formats: executive summary (1-page) for leadership and detailed report for program teams. Covers RAG status per workstream, accomplishments, upcoming milestones, blockers, and action items. Pulls data from available project management tools when configured.

## Usage

Use this skill when:

- Producing weekly program status updates
- Preparing executive summaries for leadership reviews
- Reporting on milestone completion at phase gates
- Consolidating status across multiple workstreams

## Core Concepts

### RAG Status

Rate each workstream: **Green** (on track, no risks), **Amber** (at risk, mitigation in progress), **Red** (off track, escalation needed). RAG must be justified. Include the specific reason for Amber/Red and the mitigation or escalation action.

### Two Report Formats

**Executive Summary (1-page):** Overall RAG, 3 key accomplishments, 3 upcoming milestones, top blockers, ask/escalation. No detail, decisions only.
**Detailed Report:** Per-workstream RAG, task-level progress, metrics (velocity, burn-down), full blocker list, action items with owners and due dates.

### Data Sources

Pull from available project management tools (Asana MCP if configured): task completion %, sprint velocity, overdue items, blocker tickets. If unavailable, prompt user for: completed items this period, planned items next period, blockers, and risks.

## Output Format — Executive Summary

1. **Program Name & Date**: report period
2. **Overall RAG**: single status with one-line justification
3. **Key Accomplishments**: 3-5 bullet points, outcome-focused
4. **Upcoming Milestones**: next 2 weeks, with dates and owners
5. **Blockers & Risks**: top items with owner and mitigation
6. **Ask / Escalation**: what you need from leadership (or "None")

## Output Format — Detailed Report

1. **Workstream Status Table**, with columns: Workstream, RAG, % Complete, Key Update, Next Milestone, Blocker
2. **Accomplishments**: per workstream, with links to artifacts/PRs
3. **Metrics**: sprint velocity, burn-down trend, scope changes
4. **Action Items Table**, with columns: Action, Owner, Due Date, Status, Notes
5. **Risks & Issues**: link to RAID log (risk-management skill)
6. **Next Period Plan**: key deliverables for next reporting period

## Quality Gate

**CRITICAL (must fix):**

- RAG status without justification
- Blockers listed without owner or mitigation
- Report period or date missing

**IMPORTANT (should fix):**

- Action items missing due dates
- No metrics or progress indicators
- Accomplishments describe activities not outcomes

**SUGGESTION:**

- Could add trend arrows (improving/stable/declining) per workstream
- Could include week-over-week RAG comparison

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
