# Capacity review, 2025-08-20

Owner: platform operations

| Measure | Observed value |
| --- | --- |
| Production hosts | 40 hosts |
| Normal fleet CPU utilisation | 72% |
| Operating ceiling used for planning | 80% |
| Spare capacity at the planning ceiling | 3.2 host-equivalents |
| Raw capacity before the ceiling | 11.2 host-equivalents |
| Typical websocket sessions | 18,000 |

The 72% value is the 30-day fleet median. The busiest weekday hour reached 77%. Review capacity if normal fleet CPU utilisation reaches 78%. A deployment pattern that needs another full 40-host serving fleet cannot fit inside the spare capacity or the approved monthly expansion. Host reservations are not elastic during a release.

Rolling a deployment across all hosts would require maintaining websocket sessions through each host's upgrade, and the 40-minute connection drain cost would remove 3.2 host-equivalents from availability. The spare capacity at the ceiling cannot cover that drain.

The fleet is split 18/12/10 across zones north, central, and south. Session-router placement is balanced across all three zones.
