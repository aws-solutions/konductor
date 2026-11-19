# Wallet rollout runbook

Before each regional flag change, confirm the named gate is visible in the launch dashboard and record the decision role in the launch ticket. Watch wallet errors, pool utilization, support coverage, and residency counters for ten minutes after a change.

If the rollback trigger fires, disable the most recently enabled regional flag, restore the previous client percentage, and keep the API route available for diagnostics. Do not remove the schema expansion while any reader still depends on it.

The release owner coordinates with Customer Support and Partner Integrations before customer-visible changes.
