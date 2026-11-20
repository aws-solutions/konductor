# Onboarding drop-off framing

The visible onboarding fall is concentrated at email verification, especially for Cloudmail recipients, after the 21 January move from `mail.harborlight.app` to `verify.harborlight.app`. Signup and profile steps remain close to their earlier levels. The 3 February analytics gap is a measurement problem, not a second behavioral collapse.

Evidence is separated by claim below. Rates use the stated denominator.

```json
{
    "success_measure": {
        "window": "Review weekly for two weeks after the delivery fix, using backend records rather than the 3 February analytics-only count.",
        "target": "Restore overall completion to at least 84.0% and Cloudmail delivery to at least 99.0% for two consecutive weeks, with analytics reconciled to the backend.",
        "baseline": "84.0%, or 8,232 of 9,800, in the 6 January week; the 13 January comparison was also 84.0%.",
        "metric": "Backend email-verification completion: identity-backend verified tokens divided by verification messages accepted by the email service, reported overall and for Cloudmail."
    },
    "recommendation": "Do not redesign onboarding now. First repair and validate Cloudmail delivery and the 21 January sending-domain change, keep the screens unchanged while the cause is tested, and monitor reconciled backend verification. Add a small verification-assist experiment only if delivery recovers but completion remains below baseline.",
    "options": [
        {
            "tradeoff": "Trace Cloudmail rejections, validate sender authentication and warm-up, and roll back the domain if needed. This addresses the largest measured failure but depends on Messaging work.",
            "name": "Repair and verify delivery first"
        },
        {
            "tradeoff": "Add clearer inbox guidance and resend handling while delivery is repaired. It may help delivered messages but cannot fix messages that never arrive.",
            "name": "Run a small verification-assist experiment"
        },
        {
            "tradeoff": "Do nothing to the product while watching backend verification and provider rates for two weeks. This is cheap and preserves a clean read, but users continue to hit the current delivery problem.",
            "name": "Leave the onboarding screens unchanged and monitor"
        }
    ],
    "evidence": [
        {
            "source": "data/funnel_weekly.csv",
            "value": "8,232 of 9,800 verification emails verified, 84.0%, in the week of 6 January; the week of 13 January was also 8,711 of 10,370, 84.0%.",
            "claim": "Pre-change verification baseline"
        },
        {
            "source": "data/funnel_weekly.csv",
            "value": "On 27 January, 5,740 of 10,700 verification emails were verified, 53.6%, about 54%, while signup and profile counts stayed near prior weeks.",
            "claim": "Post-change verification"
        },
        {
            "source": "data/provider_delivery_summary.csv",
            "value": "Cloudmail delivered 23,640 of 30,700 messages, 77.0%, and bounced 7,060, 23.0%, after the new domain; its earlier delivery rate was 99.0%.",
            "claim": "Cloudmail delivery after cutover"
        },
        {
            "source": "data/provider_delivery_summary.csv",
            "value": "Cloudmail accounted for 30,700 of 48,000 post-cutover sends, 64.0%, so its delivery problem can move the aggregate funnel.",
            "claim": "Provider concentration"
        },
        {
            "source": "data/verification_reconciliation.csv and tracking-plan.md",
            "value": "The analytics export showed 3,020 email verifications on 3 February, but the identity backend showed 5,605. The missing analytics event was a tracking outage, not evidence of a comparable behavioral drop; the restored 10 February count was 5,680.",
            "claim": "3 February reconciliation"
        },
        {
            "source": "release-log.md",
            "value": "The sending domain changed on 21 January, with no onboarding UI or email-template change in that release.",
            "claim": "Timing"
        }
    ],
    "main_problem": "New-account onboarding is falling at email verification, most clearly for Cloudmail recipients after the 21 January sending-domain change; earlier signup and profile steps remain steady."
}
```
