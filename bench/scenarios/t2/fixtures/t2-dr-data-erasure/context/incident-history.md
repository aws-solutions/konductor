# Relevant operating history

In the November queue incident, a worker held a message while the Search API returned 429 responses. The visibility timeout expired, so another worker started the same account. The duplicate writes were harmless, but the queue grew for 47 minutes before the on-call saw the age alert. The follow-up required bounded retries, idempotency by account ID, and an explicit dead-letter owner.

In a separate warehouse outage, the account stream continued to accept events while Data Platform was unavailable. The stream retained seven days of events, after which older events were discarded. Data Platform now asks producers to use `data-control-events` for privacy actions so it can prioritize and reconcile them separately from product analytics.

The team has no customer-facing status page for privacy requests. Privacy Operations receives a daily export of request references and current states from the Account service.
