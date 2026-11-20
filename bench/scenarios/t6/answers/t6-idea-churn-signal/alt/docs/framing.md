# June churn framing

## Success measure: notes

The primary measure is the share of failed-payment losses that close without a successful payment within seven days. Baseline: **402 of 612 June lost subscribers (65.7%)** were in this category. The initial target is to reduce that share while keeping duplicate-charge incidents at zero and preserving collected revenue per affected subscriber. Use a seven-day look-forward and compare the payment-recovery treatment with the no-change holdout.

## Recommendation: notes

Start with option 2, a measured payment-recovery test. Keep a no-change holdout, separate processor retries from manual payments, and report paid recovery and collected revenue. Revisit a pause or save offer after the payment route has a clean result. Do not launch a blanket discount on the strength of the cancellation survey.

## Options: notes

1. **Do nothing for now.** Keep the current failure email, three-day grace period, and no automatic retry while improving the baseline. This has no build or discount cost, but it leaves the largest observed route untreated.
2. **Test payment recovery first.** Add a controlled processor-retry and clear payment-status path for failed invoices, with a holdout and a measure of successful paid recovery. This targets involuntary loss and needs guardrails for duplicate charges, processor rules, and timing.
3. **Improve the voluntary cancellation path.** Offer pause or a narrowly targeted save choice after a member chooses cancellation. This may help the 156 voluntary losses, but it does not address failed invoices and should not be evaluated on the cancellation survey alone.
4. **Use a blanket cancellation discount.** Offer a price reduction to everyone who starts cancellation. This is easy to understand but risks paying for members who would stay, cuts contribution, and does not recover failed payments.

## Evidence: notes

* The reconciled June dashboard counts **612 lost subscribers**. **402** were failed-payment losses with no successful payment within seven days, or about **65.7%** of the total.
* **156** losses followed a voluntary cancellation flow. The remaining **54** are other or unclassified routes.
* The provider export contains **517 failed card-payment events** affecting **448 distinct subscribers**. It records **115** subscribers with a successful payment inside seven days and **402** closed without successful recovery. The event count is not a unique-subscriber count.
* The current billing policy records a failure, sends a card-update email, allows a three-day grace period, and does not schedule an automatic processor retry. A card update or support-assisted manual payment is recovery, not an automated retry.

## What problem are we solving?: notes

The June loss problem is primarily involuntary: members with a failed card payment lose their subscription after the grace period without an automated retry or a successful payment. The cancellation button is a real but smaller route. A cancellation save offer would address only the voluntary route and would miss most of the observed loss.

The right first decision is whether PantryPilot can recover valid payments before offering a price concession. The data supports testing payment recovery, not assuming that a discount will retain people who never chose to cancel.

## Caveats: notes

* The cancellation survey has **214** responses and is shown only after a member starts and confirms the cancellation flow. It excludes members whose subscriptions end after an unpaid invoice, so its price and food-volume responses are useful for voluntary-cancellation language, not for estimating the overall cause of churn.
* The cancellation-start event stream is incomplete for **June 10 through 16** because of an event-delivery outage. Do not read the low raw event count in that week as lower cancellation intent. The billing events and reconciled loss totals were not affected.
* The 517 figure is an event count and the 448 figure is a distinct-subscriber count. The dashboard category is based on the seven-day look-forward, so a raw failure on its own is not the same as a lost subscriber.

```json
{
    "caveats": [
        "The 214-response cancellation survey is a selected cancellation-flow sample and excludes involuntary unpaid-invoice endings.",
        "Cancellation-start tracking is incomplete during June 10 through 16 because of an event-delivery outage.",
        "517 is a failed-payment event count, not a unique-subscriber count; 448 is the distinct-subscriber count."
    ],
    "success_measure": {
        "window": "Seven-day look-forward after each failed card payment",
        "target": "Reduce the share versus the no-change holdout while keeping duplicate-charge incidents at zero",
        "baseline": "Baseline: 402 of 612 June lost subscribers, or 65.7%",
        "metric": "Share of failed-payment losses that close without successful payment within seven days"
    },
    "recommendation": {
        "why": "It matches the 402 failed-payment losses and the current no-automatic-retry policy. Keep a no-change holdout and measure paid recovery and collected revenue before considering a cancellation discount.",
        "choice": "Test payment recovery first"
    },
    "options": [
        {
            "tradeoff": "No build cost, but the largest loss route remains untreated.",
            "description": "Keep the current billing path and establish a clean baseline.",
            "name": "Do nothing"
        },
        {
            "tradeoff": "Targets involuntary loss, but needs duplicate-charge and timing safeguards.",
            "description": "Add controlled processor retries and a clear payment-status path with a holdout.",
            "name": "Test payment recovery"
        },
        {
            "tradeoff": "Could help 156 voluntary losses, but does not address failed invoices.",
            "description": "Test pause or a narrow save choice after a member chooses cancellation.",
            "name": "Improve voluntary cancellation"
        },
        {
            "tradeoff": "May spend margin on members who would stay and misses payment failures.",
            "description": "Offer a price reduction to every cancellation starter.",
            "name": "Blanket cancellation discount"
        }
    ],
    "evidence": [
        {
            "detail": "reconciled total",
            "value": "612",
            "metric": "June lost subscribers"
        },
        {
            "detail": "no successful payment within seven days; 65.7% of 612",
            "value": "402",
            "metric": "Failed-payment losses"
        },
        {
            "detail": "completed the cancellation flow",
            "value": "156",
            "metric": "Voluntary cancellation losses"
        },
        {
            "detail": "across 448 distinct subscribers",
            "value": "517",
            "metric": "Failed card-payment events"
        }
    ],
    "problem": "Most June subscriber loss is involuntary payment churn: failed card payments close without an automated retry or a successful payment, while the cancellation-button route is smaller."
}
```
