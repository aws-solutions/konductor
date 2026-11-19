# Capacity note

The wallet-session pool currently has a hard ceiling of 80 active connections in the launch configuration. The partner and ledger request pattern becomes unstable above 70% utilization during a regional increase.

For a first exposure, Regional Operations approves a **5% maximum canary share per region**. A full regional share may proceed only after ten minutes of stable error and pool-utilization readings.
