# Operations

The service has no external state. Populate the JSON files before starting a process, and restart after changing configuration. The CLI prints one JSON response and exits.

Use the process health checks in the hosting environment to detect a stopped worker. Cache counters are intended for local diagnostics and are reset on restart.
