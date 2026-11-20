# Rolling out orders-api

1. Build green in CI, release notes written, rollout plan in `release/rollout.yaml`.
2. Stage `half`: two hosts. Watch the overview dashboard for 60 minutes.
3. Stage `full`: the other two hosts.
4. Release manager makes the go or stop call at each stage and writes it down in `release/decisions/`.

The overview dashboard shows the whole fleet. Per-version numbers are in the per-minute export (`metrics/`), which
splits every minute by the version the hosts ran.
