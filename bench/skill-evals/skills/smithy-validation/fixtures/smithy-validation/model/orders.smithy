$version: "2"

namespace com.acme.orders

use aws.protocols#restJson1

/// Order management API for the storefront.
@restJson1
service OrderService {
    version: "2026-01-15"
    operations: [
        CreateOrder
        GetOrder
        ListOrders
        DeleteOrder
    ]
}

/// Creates an order for a customer.
@http(method: "POST", uri: "/orders")
operation CreateOrder {
    input: CreateOrderInput
    output: CreateOrderOutput
    errors: [GenericError]
}

/// Fetches a single order.
@readonly
@http(method: "GET", uri: "/orders/{orderId}")
operation GetOrder {
    input: GetOrderInput
    output: GetOrderOutput
    errors: [GenericError]
}

@readonly
@http(method: "GET", uri: "/orders")
operation ListOrders {
    input: ListOrdersInput
    output: ListOrdersOutput
}

/// Deletes an order.
@http(method: "GET", uri: "/orders/{orderId}/delete")
operation DeleteOrder {
    input: DeleteOrderInput
    output: DeleteOrderOutput
    errors: [GenericError]
}

structure CreateOrderInput {
    @required
    customerId: String

    @required
    items: LineItems

    /// Card number used to pay for the order.
    cardNumber: String

    paymentToken: String

    notes: String
}

structure CreateOrderOutput {
    @required
    orderId: String
}

structure GetOrderInput {
    @required
    @httpLabel
    orderId: String
}

structure GetOrderOutput {
    order: Order
}

structure ListOrdersInput {
    @httpQuery("nextToken")
    nextToken: String

    @httpQuery("maxResults")
    maxResults: Integer
}

structure ListOrdersOutput {
    orders: OrderList
}

structure DeleteOrderInput {
    @required
    @httpLabel
    orderId: String
}

structure DeleteOrderOutput {}

structure Order {
    @required
    orderId: String

    customer_id: String

    /// Total in the smallest currency unit.
    total: Integer

    status: String

    /// Internal DynamoDB partition key, returned for debugging.
    pk: String
}

structure LineItem {
    @required
    sku: String

    quantity: Integer
}

list LineItems {
    member: LineItem
}

list OrderList {
    member: Order
}

@error("server")
structure GenericError {
    message: String

    stackTrace: String
}
