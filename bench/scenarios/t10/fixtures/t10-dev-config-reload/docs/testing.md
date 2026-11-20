# Testing notes

Tests use Node's built-in runner and assertions. Time-sensitive code accepts a clock or uses a small deterministic state machine; tests do not wait for wall-clock timers. Adapter tests use in-memory deliveries and do not contact the broker.

A test should name the contract it protects and keep fixtures close to the case. The CI job runs the same command developers run locally.
