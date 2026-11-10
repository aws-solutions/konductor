# smithy-validation fixture key (model/orders.smithy)

Planted issues, with line numbers:
- Service has no auth trait (no @httpBearerAuth/@sigv4 etc., no @auth) - CRITICAL per skill gate. (service block, line 9-17)
- L59 `cardNumber` and L61 `paymentToken` lack @sensitive - CRITICAL.
- L44 DeleteOrder uses `GET` for a mutation (should be DELETE, @idempotent).
- L38 ListOrders: no @paginated, no errors list, no documentation; L82 maxResults has no @range.
- L105 `customer_id` snake_case member (others camelCase).
- GenericError (L132-136): only error shape, @error("server") used for client errors, no @httpError, exposes `stackTrace` (L135) - info leak.
- L113 `pk` exposes internal DynamoDB partition key in an output shape.
- `status` is an unconstrained String instead of an enum; strings lack @length/@pattern.

Breaking changes vs previous-model/orders.smithy (p3):
- Order.customerId renamed to customer_id (breaking for existing clients reading Order).
- Non-breaking: new operations ListOrders/DeleteOrder, new optional CreateOrderInput members, new optional GenericError.stackTrace.
