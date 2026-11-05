# Agentic estimates for the venue booking backlog

Estimates are in person-days with AI coding assistants and agents in the workflow. They are ranges, because oversight effort varies more than authoring effort. The tier of each row comes from its description.

| ID | Item | Legacy | Tier | Low | Mid | High | Reason |
|----|------|--------|------|-----|-----|------|--------|
| E-1 | Venue settings CRUD pages and boilerplate | 10 | high | 5.0 | 5.8 | 6.7 | Patterned authoring that assistants write well; review and testing stay. |
| E-2 | Admin dashboard scaffold and forms | 8 | high | 4.0 | 4.6 | 5.3 | Scaffolding and boilerplate, same reasoning as E-1. |
| E-3 | Payment provider webhook for refunds | 12 | medium | 10.5 | 11.1 | 11.8 | Clear intent but a novel integration: little of the work compresses and verification adds time. |
| E-4 | Multi-region failover and security architecture | 20 | low | 22.0 | 22.7 | 23.5 | Novel architecture and security. Almost nothing compresses and the added verification makes it cost more than before. |
| E-5 | Migrate the old report tables | 6 | high | 2.6 | 3.5 | 4.4 | Migration is patterned work. |

## Rows not converted

- **E-6 (Tune the nightly report export, "about two weeks")**: the estimate is not a number, so it is not converted and not in the totals. Please give a value in person-days. If two weeks of one person were meant, that is 10 days, but this is an assumption.
- **E-7 (no description)**: the item has no description, so no tier can be inferred. It is not converted and not in the totals. Please say what the item is.

## Roll-up

Converted rows: legacy 56 person-days, agentic mid 47.7 (low 44.1, high 51.7). That is about 15 percent lower than the legacy total.

## How to read this

- The saving comes from the authoring part of the work. Review, integration, verification and security judgment do not shrink, which is why E-3 barely moves and E-4 goes up.
- A flat discount for the whole backlog would be wrong: it would undercount E-4 by roughly half.
- The factors behind the tiers are defaults. Calibrate them against the team's own history before using these numbers in a plan.
