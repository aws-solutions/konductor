# Integration guide: billing rules

Owner: platform. Conflicts with `docs/REQUIREMENTS.md` are settled in `docs/DECISIONS.md`.

The same rule ids as in the product requirements. `updated` is the date the rule was last changed.

| id | topic | value | updated | tag |
|----|-------|-------|---------|-----|
| R1 | Trial length | 7 days from the start of the trial | 20 May 2025 | |
| R2 | Refund window | Up to and including 30 days after payment | 2025-06-01 | |
| R3 | Proration rounding | Round half up to the cent, wherever an amount is prorated | 2024-12-01 | [regulatory] |
| R4 | Grace period | 5 days after a failed payment | 2025-04-01 | |
| R5 | Seats on the team plan | 10 | 2025-01-15 | |
| R6 | Prices for EU customers | Listed prices include tax; tax is the part of the price that is VAT | 2025-01-10 | [regulatory] |
| R7 | Annual billing discount | 20% off twelve months | 1 Sep 2025 | |
| R8 | Money | Integer cents everywhere, no floating point amounts in results | 2024-11-01 | |
| R9 | Cancellation | Takes effect immediately; the unused part of the paid period is credited, prorated | 2025-02-02 | [regulatory] |
| R10 | Extra team seats | 450 cents per extra seat per month | 2025-07-01 | |

Function reference: `startTrial`, `refundFor`, `prorateCredit`, `planChangeCharge`, `cancelSubscription`, `seatLimit`,
`seatOverage`, `quote`, `graceDeadline`. See the README for the units.
