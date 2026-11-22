# Current Orders service architecture

The Orders API runs in three availability zones behind the shared gateway. Requests enter the API service, which calls the Catalog service for product validation during checkout and stores order data in PostgreSQL. The fulfillment consumer reads order events from the queue and updates the order status. The reporting team reads a PostgreSQL read replica.

The repository interface has these operations:

- `createOrder` writes an order and returns its identifier.
- `getOrder` returns the order and all purchased lines.
- `listCustomerOrders` accepts the authenticated customer ID, an opaque cursor, and a page size.
- `listFulfillmentOrders` accepts a status, a time range, and a page size.
- `applyStatusEvent` accepts an event ID and a status transition.

The gateway puts the authenticated customer ID in the request context. Customer-scoped handlers use that value rather than a client-provided identifier. Fulfillment handlers require an operator role. The service account has read and write access to the order store, while the reporting account has read-only access.

The queue consumer has a 90-second visibility timeout and a maximum receive count of five before an event goes to the dead-letter queue. It may deliver the same event more than once. The current PostgreSQL status transition records an event ID and ignores an event ID that has already been applied.

The API supports a cursor for customer history because some customers have more than 100,000 historical orders. A normal history page is 20 orders and the maximum requested page is 50. Order details include every line and are returned from one repository call.
