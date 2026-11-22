# Operations

The daily reconciliation job is safe to run while account traffic is active. It checks every account in the store, including accounts created on the day of the run. A difference is reported with the account id and the journal total.

The worker process is stateless. Its timer is configured in UTC so a host's locale and daylight-saving rules do not change when a schedule fires. Operators can rerun a failed job after checking its error record.
