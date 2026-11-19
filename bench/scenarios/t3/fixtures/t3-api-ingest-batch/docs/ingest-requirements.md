# Intake API requirements

The production gateway terminates a request when its body is larger than 256 KiB. A typical encoded reading occupies 380 bytes before it is placed in the batch envelope. Reserve 512 bytes for the envelope and metadata rather than treating the reading size as the entire HTTP body.

The ingest service has a p99 completion target of 500 ms for an accepted batch. A response may report accepted, rejected, or deferred readings independently. Clients retry with a caller-supplied idempotency key, so a retry must not create a second batch.

The API review also requires a queryable batch status resource. The status response needs enough information for a client to tell whether every item completed, whether some items remain deferred, and which individual items failed.

The old pilot gateway allowed a 1 MiB request body. That value is superseded by the production gateway's 256 KiB setting and must not be used for this contract.
