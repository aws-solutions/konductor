# Product requirements: orders

## Customer checkout

A customer can place an order from web or mobile. After the place request returns success, the order must be visible in the customer's order list and detail view immediately. The product wording for this is "read your write": the customer should not need to refresh later or wait for a background job. A duplicate place request with the same idempotency key must return the original order.

The order detail view shows status, line items, prices, delivery address, and the customer-facing order number. Prices are the committed checkout prices, not a later recalculation.

## Support changes

Support agents can correct a delivery address, change a line quantity before fulfillment, and cancel an order when policy allows it. The support console displays the result of a successful change immediately. When two agents edit the same order, the second request must receive a conflict rather than silently overwriting the first change.

Every support change must identify the agent and reason. Retained records must support an investigation for at least 18 months. Customers can request account deletion, and the privacy service sends a deletion request to every system that stores customer-linked order data.

## Compatibility

Existing clients depend on the create, get, update, and cancel endpoints and on their current status codes. A client may retry a timed-out write. Fulfillment must continue to receive one logical placement notification for each accepted order.
