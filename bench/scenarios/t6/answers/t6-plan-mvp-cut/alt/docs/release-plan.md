# Tenant Portal MVP Release Plan

## Next Steps: notes
* Finalize sprint-by-sprint breakdown
* Schedule security audit around QA availability
* Begin implementation January 6, 2025

## Risk Mitigation: notes
* 2-point buffer (209 vs 211 capacity) for unexpected issues
* Critical path identified: TEN-101 → TEN-102 → TEN-104 → TEN-108 → TEN-113
* QA environment downtime in March accounted for in sprint planning

## Chosen MVP Items (Total: 209 points): notes

```json
{
    "requirements": [
        {
            "text": "Team capacity is 211 points (7 sprints × 32 points minus 13 points for 60% capacity during Feb 10-14).",
            "id": "capacity"
        },
        {
            "text": "Contract requires compliance reporting (TEN-113) which depends on manager dashboard (TEN-108), so both are included.",
            "id": "contractual"
        },
        {
            "text": "TEN-121 duplicates TEN-103 (maintenance request), counted once as 5 points.",
            "id": "duplicate"
        },
        {
            "text": "TEN-123 (contract terms) is 3 points per email thread, needed for legal compliance.",
            "id": "missing-estimate"
        },
        {
            "text": "Dependency chain: TEN-101 → TEN-102 → TEN-104 → TEN-108 → TEN-113 all satisfied.",
            "id": "dependencies"
        },
        {
            "text": "209 points chosen leaves 2 points buffer from 211 capacity for contingencies.",
            "id": "buffer"
        }
    ],
    "totalPoints": 209,
    "deferred": [
        "TEN-106",
        "TEN-109",
        "TEN-110",
        "TEN-111",
        "TEN-112",
        "TEN-114",
        "TEN-115",
        "TEN-118",
        "TEN-119",
        "TEN-121",
        "TEN-124",
        "TEN-125"
    ],
    "chosen": [
        "TEN-101",
        "TEN-102",
        "TEN-103",
        "TEN-104",
        "TEN-105",
        "TEN-107",
        "TEN-108",
        "TEN-113",
        "TEN-116",
        "TEN-117",
        "TEN-120",
        "TEN-122",
        "TEN-123"
    ]
}
```

## Key Decisions & Rationale: notes

1. **Included TEN-120 (2FA)**: Security enhancement worth 5 points, though not contractually required.

2. **Deferred messaging system (TEN-110)**: 13 points that can be handled via email initially.

3. **Deferred document upload (TEN-106)**: Manual process acceptable for MVP, saves 5 points.

4. **Included TEN-117 (audit trail)**: 5 points for compliance and security.

5. **Adjusted for duplicate**: Count TEN-103 (5 points) once, ignore TEN-121 duplicate.

## Capacity Analysis: notes
* **Available sprints:** 7 sprints (Jan 6 - Apr 15, 14 weeks)
* **Team velocity:** 32 points per sprint (historical average)
* **Adjusted capacity:** 211 points (224 points minus 13 points for reduced capacity week Feb 10-14)
* **Contractual deadline:** April 15, 2025 (non-negotiable)

## Summary: notes
Based on the April 15, 2025 deadline and team capacity analysis, here's the feasible MVP scope that meets contractual obligations while staying within our 211-point capacity.
