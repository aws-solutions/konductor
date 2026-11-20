# Consumers

The Fulfillment listener reads payment.status.changed messages. It deduplicates with the `x-event-id` header and applies messages in order per order identifier. It does not require a single order across all orders to be globally ordered.
