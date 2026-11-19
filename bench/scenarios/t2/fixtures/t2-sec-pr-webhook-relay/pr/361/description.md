# Add a generic signed webhook receiver

This pull request adds one receiver for the source-control and billing event
paths, normalizes accepted payloads, and sends the normalized event to the
customer notification destination. It keeps provider-specific header handling
at the edge and leaves the existing health and payment helpers intact.

The implementation uses the built-in crypto and fetch APIs, so there is no new
dependency or install step. I also added coverage for signed events, header
identifiers, signature parsing, and the startup wiring. I tested it with
`node --test` on Node 24 and the existing health and storage checks pass.
