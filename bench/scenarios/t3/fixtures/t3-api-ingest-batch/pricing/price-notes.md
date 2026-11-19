# Cost model notes

Finance prices the production service per calendar month of 30 days. Gateway requests and database writes are billed per million operations. The queue rate is per million readings, while worker time, retained storage, and backup storage use their named monthly units.

| Charge | Unit in the sheet | Included in the ceiling |
|---|---|---|
| Gateway | million requests | yes |
| Queue | million readings | yes |
| Workers | worker-hours | yes |
| Data and backup | GiB-month | yes |
| Monitoring | flat monthly charge | yes |
| Replication | flat monthly charge when selected | yes |

Option resource quantities are recorded separately in `fixture/data/options.json`; multiplying those quantities by the rates above gives the monthly estimate. Values are estimates for the steady fleet, not per-device invoices.
