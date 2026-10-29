# Product requirements: billing rules

Owner: product. This document is the source of truth for billing behavior.

Each rule has an id. `updated` is the date the rule was last changed. A rule marked `[regulatory]` comes
from a legal or tax obligation.

| id | topic | value | updated | tag |
|----|-------|-------|---------|-----|
| R1 | Trial length | 14 days from the start of the trial | 2025-02-01 | |
| R2 | Refund window | Up to and including 30 days after payment | 2025-06-01 | |
| R3 | Proration rounding | Round half up to the cent, wherever an amount is prorated | 2024-12-01 | [regulatory] |
| R4 | Grace period | 5 days after a failed payment | 2025-04-01 | |
| R5 | Seats on the team plan | 10 | 2025-01-15 | |
| R6 | Prices for EU customers | Listed prices include tax; tax is the part of the price that is VAT | 2025-01-10 | [regulatory] |
| R7 | Annual billing discount | 15% off twelve months | 2025-03-01 | |
| R8 | Money | Integer cents everywhere, no floating point amounts in results | 2024-11-01 | |
| R9 | Cancellation | Takes effect at the end of the paid period; nothing is credited | 2025-04-10 | |
| R10 | Extra team seats | 500 cents per extra seat per month | 2025-06-15 | |

Other facts, not in dispute: the starter plan has 1 seat, the enterprise plan has unlimited seats, monthly
list prices are starter 900, team 2900 and enterprise 9900 cents, and EU VAT is a flat 20%.
