# Add scheduled transfers

This change adds the timer-facing worker for recurring account transfers. It reuses the journal format, records a client key, and keeps the timer adapter small so deployments can choose their own scheduler.

The worker accepts configured decimal amounts, runs due entries, records the result for operators, and keeps reconciliation focused on active accounts. I tested the full Node test suite with Node 24 and checked the new scheduler cases at the configured minute.
