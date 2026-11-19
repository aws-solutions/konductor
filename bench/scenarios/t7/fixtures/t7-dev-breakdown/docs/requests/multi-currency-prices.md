# Request: multi-currency product prices

Product buyers are in several markets. Extend the catalog so a caller may request a supported currency with `GET /v1/products?currency=EUR`. The response should include the selected currency and an amount formatted with the existing money rules. A missing query parameter keeps today's USD behavior. Unsupported codes return the service's normal client error.

The first rollout supports USD, EUR, and GBP. The existing amount for every product must remain available as its USD price. A regional price feed will populate non-USD prices separately; this change must not invent exchange rates. The partner CSV and price-notification email must display the same currency-aware price as the API.

Keep the change safe for a rolling deployment: database changes are applied before application instances that read the new shape. Cover the request, fallback, unsupported input, and output-format behavior with tests. Update the operator-facing API example when the response contract changes.

Requester acceptance examples:

- an omitted currency returns USD;
- a EUR request never returns a cached USD amount;
- a product with a regional amount shows that amount in the API, CSV, and notification;
- existing USD callers remain compatible.
