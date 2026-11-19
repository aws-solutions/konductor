# Current API routes

The public API is versioned under `/v2`. Merchant applications create payment intents and query payment and refund state. Authentication uses bearer tokens issued by the dashboard.

There is no outbound callback route today. The API gateway rejects unknown methods before they reach the payments service. Request errors use the shared problem shape described in the API reference.
