# Search indexer contract

The indexer consumes one JSON object per line from the `product.changed` topic. It reads these product fields:

| Field | Type | Use |
| --- | --- | --- |
| `id` | string | document key |
| `name` | string | title |
| `status` | string | availability filter |
| `priceCents` | number | numeric range filter, in cents |
| `labels` | string[] | facet values |

The indexer rejects a record when `priceCents` is not a finite number. It does not coerce strings because malformed prices would sort unpredictably. Event version `1` is retained for replaying the last 30 days of records.
