# Notification delivery requirements

The product team wants one production notification path for the North, Central, and South service regions. A message should be accepted once and delivered by the regional workers without making the sender wait for downstream retries. The architecture review should compare the candidates named in `options.json`.

## Service objectives

| Objective | Production requirement | Measurement |
|---|---:|---|
| Delivery latency | p99 no more than 3 seconds | time from accepted message to worker handoff |
| Monthly spend | no more than 4,500 USD | steady-state service charges in a 30-day month |
| Recovery point | no more than 60 seconds of accepted messages | loss window after a regional failure |
| Recovery time | restore processing within 15 minutes | from incident declaration to resumed processing |

The 3-second target applies at the peak rate in the traffic profile, not only during the daily baseline. The monthly spend ceiling includes request, transfer, and worker charges listed on the price sheet.

An earlier staging note mentioned an 8-second p99 objective. That note is superseded by this production table and must not be used for the decision.
