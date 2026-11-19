# Push gateway checks

The gateway can return transient 429 and 503 responses. Consumers retry those responses with backoff. A successful call includes `gateway_request_id` and an acknowledgement line in the consumer log.

Use the gateway health endpoint only after checking queue movement. Gateway latency alone does not explain a partition that has stopped acknowledging events.
