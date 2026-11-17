# Supplier item service (legacy)

`GET /items/{sku}` returns one record:

| field | meaning |
|---|---|
| `ITM_NO` | the SKU |
| `DESC_TXT` | display name |
| `PRC_CENTS` | price in cents as a zero-padded string, for example `"001250"` |
| `STAT` | `"A"` active, `"D"` discontinued |
| `CAT_CD` | category code |

Errors carry a `code`: `NOT_FOUND`, `BAD_REQUEST`, `BUSY` (too many calls at once) or `TIMEOUT`. `BUSY` and `TIMEOUT`
are transient. The service allows at most 4 calls in flight per client; above that it answers `BUSY`.

The nightly snapshot is an array of the same records.
