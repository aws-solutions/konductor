# Glossary

**Customer history:** the cursor-paginated list returned by `GET /v1/customers/me/orders`.

**Fulfillment queue:** orders grouped by current status for warehouse operators.

**Order item:** the DynamoDB item containing the customer-visible order header and purchased line data.

**Summary item:** a DynamoDB item containing the count and last event time for one status on one UTC day.

**GSI:** a DynamoDB global secondary index. `GSI1` is the fulfillment access path in the proposal.

**Launch peak:** the 1,800 order-write-per-second planning value during the partner promotion window.

**History cursor:** an opaque token returned by a list endpoint and supplied to fetch the next page.

**Final status:** the status used for hourly reporting after the fulfillment workflow reaches its terminal state.
