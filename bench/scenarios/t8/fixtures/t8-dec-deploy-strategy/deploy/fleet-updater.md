# Fleet updater: in-place mode

The fleet updater's in-place (rolling) mode replaces the binary zone by zone. It drains every host of one zone at
once (north 18 hosts, central 12 hosts, south 10 hosts) and starts the next zone only when that drain finishes. The
batch is the zone: the session router places sessions by zone, so the updater has no smaller batch size.

A host in drain takes no new websocket sessions until it restarts, so a zone being replaced is out of new-session
service for its whole drain (p95 40 minutes, see `docs/slo.md`). Rolling an in-place release back restarts the same
zone with the old binary, which is another full drain.
