# Pinboard product requirements, Q1 planning draft

Owner: Inez Calder, product
Last reviewed: 2024-12-18

## Product requirements: notes

* A new account can create a Workspace from the home screen.
* A member can add, search, and archive notes inside a Workspace.
* A Workspace owner can invite or remove members.
* Existing links to a Workspace continue to resolve after an account changes its display name.

## Context: notes

Pinboard helps small teams capture notes quickly, connect them to a shared Workspace, and find decisions later. The first-run experience should make the value of a shared container clear without requiring an admin workshop.

## Metrics table: notes

| Metric | Definition | Baseline | Q2 target |
| --- | --- | ---: | ---: |
| Project activation rate | Share of new accounts that create a Project and add at least one note within 7 days. | 31% (Dec 2024) | 40% |
| Weekly active Projects | Count of Projects with at least one note added in a rolling 7-day period. | 2,400 (Dec 2024) | 3,000 |
| Invited-member conversion | Share of Project invitations accepted within 14 days. | 18% (Dec 2024) | 25% |

```json
{
    "term_change": {
        "to": "Project",
        "from": "Workspace"
    },
    "metrics": [
        {
            "target": "40%",
            "baseline": "31% (Dec 2024)",
            "definition": "Share of new accounts that create a Project and add at least one note within 7 days.",
            "name": "Project activation rate"
        },
        {
            "target": "3,000",
            "baseline": "2,400 (Dec 2024)",
            "definition": "Count of Projects with at least one note added in a rolling 7-day period.",
            "name": "Weekly active Projects"
        },
        {
            "target": "25%",
            "baseline": "18% (Dec 2024)",
            "definition": "Share of Project invitations accepted within 14 days.",
            "name": "Invited-member conversion"
        }
    ]
}
```
