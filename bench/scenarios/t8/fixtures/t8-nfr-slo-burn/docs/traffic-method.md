# Traffic sample notes

The sample is exported from the request counter rollup. Each row has a UTC minute, a traffic class, a total request count, status classes, and four non-overlapping latency buckets. Counts are integer event counts, not rates.

For the 28-day customer view, include only `real_user` rows. Availability is successful customer requests divided by all customer requests, where successful means `status_2xx + status_4xx` and failed means `status_5xx`. For p99, sum the latency buckets for customer rows and select the first bucket whose cumulative count reaches 99% of customer requests. The bucket edges are 100, 300, 800, 1200, and 2000 milliseconds; the final bucket is above 2000 milliseconds. The selected edge is the reported upper bound.

A second export used by the dashboard includes all classes. It is useful for checking probe coverage but is not the customer SLI.
