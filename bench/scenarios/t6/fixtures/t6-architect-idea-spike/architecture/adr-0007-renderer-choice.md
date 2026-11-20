# ADR-0007: Keep the in-house renderer (2023-06)

Status: accepted

Context. We compared a headless-browser renderer, a commercial PDF library and our own layout code (`leafpress`).

Decision. Keep leafpress. The browser option needed 600 MB+ per worker and cold starts of seconds. The commercial library had licence terms that did not fit multi-tenant SaaS.

Consequences
- We own page-break logic and table layout. It is good for invoices, weak for free-form documents.
- Single-pass, in-memory render. Streaming was considered and deferred.
- Pure JS, so it can run on any Node-compatible runtime.

Revisit when: statements regularly exceed ~100 pages, or we need free-form templates.
