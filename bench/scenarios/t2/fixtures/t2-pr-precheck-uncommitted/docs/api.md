# Quote API notes

`POST /quote` accepts `origin`, `destination`, and `weightKg`. Both address objects contain `country` and `postalCode`. A successful response contains `total`, `currency`, and `source`.

The library rejects negative weights, unknown countries, and weights above 20 kg. Carrier failures are returned to the HTTP layer as a 502 so callers can retry or show an unavailable message.
