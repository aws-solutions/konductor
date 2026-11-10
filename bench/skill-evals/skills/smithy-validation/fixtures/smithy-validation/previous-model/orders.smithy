$version: "2"

namespace com.acme.orders

use aws.protocols#restJson1

/// Order management API for the storefront.
@restJson1
service OrderService {
    version: "2025-06-01"
    operations: [
        CreateOrder
        GetOrder
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

structure CreateOrderInput {
    @required
    customerId: String

    @required
    items: LineItems

    /// Optional free-text notes.
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

structure Order {
    @required
    orderId: String

    customerId: String

    total: Integer

    status: String
}

structure LineItem {
    @required
    sku: String

    quantity: Integer
}

list LineItems {
    member: LineItem
}

@error("server")
structure GenericError {
    message: String
}
