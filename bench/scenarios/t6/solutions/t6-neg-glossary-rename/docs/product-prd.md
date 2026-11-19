# Pinboard product requirements, Q1 planning draft

Owner: Inez Calder, product
Last reviewed: 2024-12-18

## Context

Pinboard helps small teams capture notes quickly, connect them to a shared Workspace, and find decisions later. The first-run experience should make the value of a shared container clear without requiring an admin workshop.

## Product requirements

- A new account can create a Workspace from the home screen.
- A member can add, search, and archive notes inside a Workspace.
- A Workspace owner can invite or remove members.
- Existing links to a Workspace continue to resolve after an account changes its display name.

## Metrics table

| Metric | Definition | Baseline | Q2 target |
| --- | --- | ---: | ---: |
| Project activation rate | Share of new accounts that create a Project and add at least one note within 7 days. | 31% (Dec 2024) | 40% |
| Weekly active Projects | Count of Projects with at least one note added in a rolling 7-day period. | 2,400 (Dec 2024) | 3,000 |
| Invited-member conversion | Share of Project invitations accepted within 14 days. | 18% (Dec 2024) | 25% |

```json
{
  "metrics": [
    {
      "name": "Project activation rate",
      "definition": "Share of new accounts that create a Project and add at least one note within 7 days.",
      "baseline": "31% (Dec 2024)",
      "target": "40%"
    },
    {
      "name": "Weekly active Projects",
      "definition": "Count of Projects with at least one note added in a rolling 7-day period.",
      "baseline": "2,400 (Dec 2024)",
      "target": "3,000"
    },
    {
      "name": "Invited-member conversion",
      "definition": "Share of Project invitations accepted within 14 days.",
      "baseline": "18% (Dec 2024)",
      "target": "25%"
    }
  ],
  "term_change": {
    "from": "Workspace",
    "to": "Project"
  }
}
```
