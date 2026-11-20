# Decision 001: acknowledge after completion

**Status:** accepted

Harbor Hand acknowledges a delivery after the handler has produced a durable completion record. This keeps a worker crash from hiding unfinished work. Duplicate delivery is accepted because handlers use the job id as their idempotency key.
