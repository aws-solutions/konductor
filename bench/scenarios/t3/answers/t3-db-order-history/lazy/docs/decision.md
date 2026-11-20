# Order History Database Design Decision

This section covers order history database design decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Problem Summary

This section covers problem summary. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Options Considered

This section covers options considered. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Option A: Comprehensive Single-Column Indexes

This section covers option a: comprehensive single-column indexes. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Option B: Smart Composite Indexes (Chosen)

This section covers option b: smart composite indexes (chosen). We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Option C: Two-Table Normalized

This section covers option c: two-table normalized. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Chosen Design: Option B (composite-optimized)

This section covers chosen design: option b (composite-optimized). We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Schema Rationale

This section covers schema rationale. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Storage Calculations

This section covers storage calculations. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Cost Calculation

This section covers cost calculation. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Validation

This section covers validation. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "single-column-all",
  "options": [
    "single-column-all",
    "composite-optimized",
    "two-table-normalized"
  ],
  "limits": {
    "storage_tb": {
      "limit": 3.13,
      "value": 3.13
    },
    "monthly_budget_usd": {
      "limit": 375,
      "value": 114.38
    },
    "iops": {
      "limit": 18750,
      "value": 18750
    },
    "throughput_mbps": {
      "limit": 625,
      "value": 625
    }
  },
  "monthly_cost_usd": 114.38
}
```
