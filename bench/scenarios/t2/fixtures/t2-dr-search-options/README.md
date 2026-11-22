# Product search options packet

This packet supports a design review for the shop catalogue search service. It was assembled by the Storefront Platform team in March 2025 from the current architecture notes, operating targets, finance worksheet, and catalogue contracts. Maya Chen wrote the design, with input from the Catalogue and Reliability teams.

The document under review is `docs/design/product-search-options.md`. The other files describe the system around it and provide the numbers and constraints used by the team. The packet is self-contained and uses no production credentials or customer data.

The packet covers three product-search alternatives: retaining indexed database `LIKE` queries, adopting a managed search service, and operating a search cluster. It records catalogue size, traffic growth, service targets, team ownership, cost figures, language requirements, and the indexing contract for the review.
