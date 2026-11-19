# Demand profile

The current production trace covers the month-end close, when the cache is largest and request concurrency is highest. The traffic team uses the following values for capacity planning.

| Demand measure | Current planning value | Unit | Window |
| --- | ---: | --- | --- |
| Working set, ordinary day | 90 | GB | Monthly average |
| Working set, month-end peak | 118 | GB | Highest observed planning window |
| Sustained cache reads | 800 | requests/second | Month-end peak |

An earlier staging pilot reached 600 requests/second, but that value is **superseded by the current 800 requests/second production target**. The staging pilot used a smaller data set and is not the basis for the production decision.
