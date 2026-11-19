# Checkout data contract

The edge accepts a checkout request up to **256 KB** before compression. The current production replay's largest envelope is 96 KB, as recorded in `traffic.md`; a larger request is rejected before it reaches payment. This limit covers headers, customer choices, and line items together.

| Data constraint | Limit |
| --- | ---: |
| Maximum uncompressed checkout request | 256 KB |
| Largest current replay envelope | 96 KB |
| Maximum item count | 80 |

The architecture choice may change how pricing is obtained, but it must not enlarge the request envelope.