# Current architecture

## Runtime shape

The storefront, account, returns, and subscription endpoints run in the Commerce monolith. Checkout is a module inside that process. It validates a cart, authorizes a payment, reserves stock, writes an order, and emits an order-created event after the database transaction commits. The module has a synchronous interface used by several controllers and a small set of scheduled jobs.

The monolith and its modules use one PostgreSQL cluster named commerce-primary. A module may read tables owned by another module today, but writes are expected to go through the owning module's transaction boundary. The database has one writer and two read replicas. Replica lag is normally below 150 ms, but the checkout path reads its own writes from the primary.

## Deployment and traffic

The monolith runs 18 application pods across three zones. Deployments use a rolling update and keep the old revision available until health checks pass. The checkout module is responsible for roughly 21% of request CPU and 34% of database write I/O during the weekday peak.

The proposed Checkout Service would run separately from the monolith. Payments and Fulfillment are separate teams and already expose internal APIs. The Customer Foundations team owns account data and the customer profile API.

## Existing behavior users rely on

A successful checkout returns an order identifier only after payment authorization and stock reservation have completed. A declined payment does not create an order. A stock shortage leaves the cart available for another attempt. Repeating the same browser submission with the same checkout token returns the original result rather than charging twice.

The monolith currently puts a request ID and checkout token in its structured logs. Customer support searches by either value when investigating an order.
