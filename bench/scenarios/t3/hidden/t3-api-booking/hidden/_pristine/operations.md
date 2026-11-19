# Operations worksheet

The production estimates use the current gateway and request profile. The API team records a list p95 of 240 ms for the cursor experiment and 320 ms for the offset experiment. Both were measured against the same room/date-range workload, and the capacity and continuity values are in `traffic.json` so the calculation can be reproduced.

The production gateway is the source for response-size acceptance. Local smoke tests use a separate configuration; those settings are not production data-size limits. Production acceptance uses the 1 MiB cap in `requirements.md`.

The API estimate uses a monthly base charge plus per-million charges for list, get, and create requests. There are no separate fees for the continuation token.
