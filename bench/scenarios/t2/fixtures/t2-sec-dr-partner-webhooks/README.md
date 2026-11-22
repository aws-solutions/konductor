# Partner event delivery review packet

This packet contains the design and operating context for sending order events from a multi-tenant commerce platform to partner webhooks. It is prepared for a design review before the first production pilot.

The document under review was written by the Partner Integrations team: Mira Chen (staff engineer), Tomas Ibarra (product engineer), and Leena Shah (SRE). The surrounding context files were assembled by Platform Architecture, Trust and Safety, and Partner Operations. They record current behavior, contractual facts, service targets, and an incident timeline without prescribing a review outcome.

Start with `docs/design/partner-event-delivery.md`. The files under `context/` are the source of truth for the current platform and its operating constraints:

- `current-architecture.md` describes the services and network boundaries.
- `auth-service.yaml` records the current partner-auth service interface and key lifecycle.
- `data-classification.md` lists field classes and approved recipients.
- `partner-contracts.csv` records tier commitments and contract limits.
- `traffic-and-slos.json` records volume, growth, and service targets.
- `incident-2024-11.md` records a prior partner endpoint incident.
- `glossary.md` defines the terms used by the team.

This is an internal working packet with synthetic names and values for review practice. No production credentials are included.
