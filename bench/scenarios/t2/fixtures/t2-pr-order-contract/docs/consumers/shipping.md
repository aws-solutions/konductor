# Shipping consumer contract

The shipping worker subscribes to `orders.updated`.

It reads these fields from each JSON message:

| Field | Type | Use |
| --- | --- | --- |
| `event` | string | routes the message |
| `orderId` | string | loads the shipment |
| `customerId` | string | selects the delivery account |
| `status` | string | controls the packing state |
| `sequence` | integer | rejects an older update |
| `changedAt` | ISO date string | records the delivery timeline |

The worker compares `sequence` numerically. Messages with a lower sequence than the last applied message are ignored. The queue name is `orders.updated`.
