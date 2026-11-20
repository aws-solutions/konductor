# Operations notes

The nightly count import runs outside this process. It treats a missing line
as unchanged and rejects negative quantities. The in-memory adapter is for
local development and tests only.

Warehouse timestamps are stored as ISO 8601 UTC strings with a trailing `Z`.
Logs use the warehouse's configured timezone for display, but comparisons use
UTC. The service does not own a scheduler; a small process invokes cleanup
jobs on a regular interval.

Keep event payloads small and include the request id when one exists. A failed
mirror publish should be visible to the caller because the retry worker uses
that failure signal.
