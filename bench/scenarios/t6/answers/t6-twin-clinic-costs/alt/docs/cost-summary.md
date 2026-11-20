# MotionSpring monthly SMS cost summary

The working appointment volume is six booked appointments: three for Cedar Grove Rehab, two for Harbor Point Therapy, and one for Northgate Mobility. The cancelled appointment is not part of the expected message volume.

BrightRelay quotes a shared monthly platform fee of $180 for up to 2,000 outbound messages. The working volume is below that allowance, so the $0.06 overage rate does not apply. I allocated the shared fee in proportion to each clinic's booked volume. On that basis, Cedar Grove Rehab has the highest monthly allocation at $90.

The $1,250 setup charge is one-time, not monthly. Inbound replies are an optional add-on with a price still to be confirmed, so they are excluded from this estimate.

```json
{
    "assumptions": [
        "Booked appointment rows represent the expected monthly message volume; cancelled rows are excluded.",
        "The $180 account fee is allocated across clinics in proportion to booked appointments. The 2,000-message allowance is not exceeded, so the $0.06 overage rate does not apply.",
        "Inbound replies are optional and unpriced in the quote, so they are excluded."
    ],
    "highestCostClinic": "Cedar Grove Rehab",
    "totalMonthlyCostUsd": 180,
    "clinics": [
        {
            "monthlyCostUsd": 90,
            "bookedAppointments": 3,
            "name": "Cedar Grove Rehab"
        },
        {
            "monthlyCostUsd": 60,
            "bookedAppointments": 2,
            "name": "Harbor Point Therapy"
        },
        {
            "monthlyCostUsd": 30,
            "bookedAppointments": 1,
            "name": "Northgate Mobility"
        }
    ]
}
```
