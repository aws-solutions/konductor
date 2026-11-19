# Sensor intake workspace

This workspace contains the operating notes for a small fleet-ingest service. The contract is being replaced because the first gateway tier was sized for an earlier pilot. Treat the current operating notes and the marked revision notes as the source for the design; `current-api.md` is only a description of what exists today.

The design should leave room for partial success. A request can contain readings from devices that are temporarily unavailable, so clients need a way to correlate each item with its outcome.

The monthly figure in the finance note is a service budget, not a promise to spend the whole amount. Reliability targets are measured for the production fleet, while the example sandbox settings are not production commitments.
