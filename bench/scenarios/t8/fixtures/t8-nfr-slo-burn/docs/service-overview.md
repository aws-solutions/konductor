# Payments API service overview

`payments-api` accepts card authorization requests and returns the authorization result to Checkout. `payments-worker` handles settlement and reconciliation after the synchronous request. The API talks to `card-network` through a bounded client connection pool.

Customer requests use `traffic_class=real_user`. Load-balancer checks use `health_check`, and the synthetic checkout monitor uses `synthetic`. The traffic CSV contains one row per minute per class. The `status_5xx` count is the failed-event count for the availability review; a 4xx is a valid response from the API boundary and remains in the request denominator.

For the latency review, sum the latency columns for customer rows and select the first bucket whose cumulative count reaches 99% of customer requests. The bucket edges are 100, 300, 800, 1200, and 2000 milliseconds; the final bucket is above 2000 milliseconds. The selected edge is the reported upper bound.
