# Checkout extraction design packet

This packet contains the proposal to move checkout out of the web monolith into the Checkout Service. It was assembled for an architecture review by the Commerce Platform team. The proposal was written by Maya Chen, staff engineer, with contributions from Payments and Fulfillment, and the context files were exported by the owning teams on 2025-02-14.

The packet is intentionally self-contained. `docs/design/checkout-service-extraction.md` is the document under review. Files under `context/` describe the current system, service targets, traffic, data ownership, request callers, schema, and a recent incident. Numbers are production estimates unless a file labels them as a target or a forecast.

The expected decision is whether the team can begin implementation in the next planning cycle. Names in this packet are fictional and do not identify a real company or service.
