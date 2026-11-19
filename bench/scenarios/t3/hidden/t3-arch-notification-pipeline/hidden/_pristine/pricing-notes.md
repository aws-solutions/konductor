# Production price sheet notes

The attached JSON is the source of numeric prices. The service bills queue-style request units at **0.10 USD per million**, managed transfer at **0.03 USD per decimal GB**, and an active delivery worker at **0.11 USD per hour**. Use 720 hours for the 30-day estimate.

A request unit is one publish, receive, or acknowledgement operation. A candidate's `request_units_per_message` already accounts for the operations it needs. Its transfer multiplier accounts for copies made by that candidate before worker handoff. Do not add a second request charge for worker polling.

The estimate is a steady-state estimate. It excludes one-time setup and taxes, and it must use the traffic schedule rather than multiplying the peak rate across every hour.
