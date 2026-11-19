# LanternDesk data architecture packet

LanternDesk is a B2B ticketing service. Each customer account is a tenant, and agents search and update tickets throughout the day. The packet below is the material available to the architect. The JSON files are exports from planning tools; the Markdown files are notes from product, operations, and finance.

The architecture must keep tenant boundaries explicit in data access. Customer-facing ticket keys are only human-readable within a tenant. A schema review will exercise tenant-scoped lookups, status queues, and recent-ticket views on a small SQLite database before the design is approved for the larger estate.

Read the traffic, data-shape, service-level, pricing, and option notes together. Some planning values describe demand, while others are service limits or pricing inputs.
