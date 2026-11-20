# Pricing test framing

The first-purchase chart makes Variant B look better, but it is not safe to publish. The result mixes an uneven assignment split, a campaign routed to B, and a much higher refund rate on B. Keep Control as the default until a clean repeat answers the question.

```json
{
    "next_step": {
        "release_rule": "Publish the new page only if the clean repeat shows a positive retained-conversion effect after refunds and the assignment and campaign checks pass.",
        "baseline": {
            "variant_b_rate": 0.0668,
            "control_rate": 0.0643
        },
        "measure": "seven-day retained paid conversion, with gross annual_paid orders minus refund_7d orders",
        "action": "Keep Control live, stop routing promotions to Variant B, and rerun the page comparison with a verified 50/50 assignment and no overlapping campaign. Hold the decision until every assigned learner has seven days of refund observation."
    },
    "adjusted_result": {
        "basis": "Across all dates, Control retained 359 of 5,584 assigned learners (6.43%) and Variant B retained 351 of 5,256 (6.68%), about +0.3 percentage points. Excluding the four overlapping dates, Control retained 264 of 4,054 (6.51%) and Variant B retained 228 of 3,816 (5.97%), about -0.5 points. These readings bound the adjusted result rather than the +0.96-point gross lift.",
        "high_pp": 0.3,
        "low_pp": -0.5,
        "metric": "seven-day retained paid conversion"
    },
    "options": [
        {
            "assessment": "Reject. It would treat the campaign and gross purchases as page evidence and would ignore the assignment and refund checks.",
            "name": "Roll out Variant B now"
        },
        {
            "assessment": "Choose this. Balance the assignment, block campaign routing during the run, and wait through the seven-day refund window.",
            "name": "Keep Control and rerun cleanly"
        },
        {
            "assessment": "Reject as a permanent pricing decision. The email is a separate offer and this test did not estimate its incremental effect.",
            "name": "Keep B only for the spring-credit audience"
        }
    ],
    "raw_result": {
        "difference_pp": 0.96,
        "variant_b": {
            "rate": 0.0778,
            "assigned": 5256,
            "paid": 409
        },
        "control": {
            "rate": 0.0682,
            "assigned": 5584,
            "paid": 381
        },
        "metric": "gross paid conversion"
    },
    "issues": [
        {
            "impact": "The sample-ratio check is not a clean randomised comparison, so the apparent winner should be treated as directional.",
            "evidence": "The assignment export has 5,584 Control learners and 5,256 Variant B learners. That is 51.51% versus 48.49%, instead of the intended 50/50 split; the summary reports p=0.0016.",
            "name": "Uneven assignment"
        },
        {
            "impact": "The mid-run lift cannot be attributed to the page copy because the promotion and the page variant moved together.",
            "evidence": "The Spring Skills Credit email ran 15–18 April, delivered 4,860 messages, and its send rule routed recipients to Variant B. B's daily paid counts rose during those dates, while the assignment export has no campaign-id field.",
            "name": "Campaign overlap"
        },
        {
            "impact": "Refunds remove most of the gross-purchase advantage and make the B experience less attractive on retained paid conversion.",
            "evidence": "Control has 22 seven-day refunds from 381 gross paid orders (5.77%), while B has 58 from 409 (14.18%). Gross net-of-refund orders are therefore 359 for Control and 351 for B.",
            "name": "Refunds change the outcome"
        }
    ],
    "decision": "Hold Variant B pending a clean repeat. Keep the current Control page and do not make a permanent pricing-page change yet."
}
```
