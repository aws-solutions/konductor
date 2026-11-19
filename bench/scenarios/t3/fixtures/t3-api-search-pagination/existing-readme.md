# Catalog search API, current notes

This repository contains the small public contract for catalog search. Existing clients send `q` and a `page_size` to the gateway, and the gateway currently forwards a page number to the data service. The current contract was written before the catalog passed ten million items.

The search response includes `items`, `total`, and a boolean indicating whether more records exist. Several crawler integrations keep requesting pages until that boolean is false. Browser clients usually stop after the first few dozen pages. The API owner wants the next contract to keep response bodies bounded and to avoid exposing storage-specific identifiers.

## Operational context

The production measurement in `traffic.csv` is the source for current load planning. An older staging experiment is retained there for comparison only. The reliability and capacity tables are separate because operations updates them on a different review cycle.

When editing the public contract, keep error responses JSON-shaped and document which response fields can be absent. Do not assume that clients can decode a vendor-specific binary token.
