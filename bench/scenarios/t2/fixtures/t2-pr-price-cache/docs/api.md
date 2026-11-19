# HTTP API

All endpoints require `x-tenant-id`. A tenant can only read and write its own catalog.

- `GET /v1/products` lists products.
- `GET /v1/prices/:list` returns the current list.
- `PATCH /v1/prices/:list/:product` changes one price.
- `PUT /v1/prices/:list` replaces all prices in a list.

Price amounts are decimal numbers and the service returns the stored `updatedAt` value.
