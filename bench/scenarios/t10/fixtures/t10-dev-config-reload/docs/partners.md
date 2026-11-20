# Partner dependencies

The Ferry Desk team submits jobs through the `harbor-delivery` queue and expects the `jobId` and `attempt` fields to remain stable. The Tide Ledger team reads the completion webhook and retries a missing response for up to ten minutes.

The Platform team owns the deployment controller and supplies the environment variables listed in the configuration guide. They do not edit worker source files during an incident.

The support console calls the readiness endpoint before offering a replay button. Its timeout is two seconds, so probe handlers must not wait on the broker.
