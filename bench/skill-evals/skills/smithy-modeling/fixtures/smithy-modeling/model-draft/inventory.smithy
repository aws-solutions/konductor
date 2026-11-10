$version: "2"

namespace inventory

service InventoryService {
    version: "2025-01-01"
    operations: [GetItem, ListItems, PutItem, DeleteItem]
}

@http(method: "GET", uri: "/items/{item_id}")
operation GetItem {
    input: GetItemInput
    output: GetItemOutput
}

@http(method: "GET", uri: "/items")
operation ListItems {
    input: ListItemsInput
    output: ListItemsOutput
}

operation PutItem {
    input: PutItemInput
    output: PutItemOutput
}

@http(method: "DELETE", uri: "/items/{item_id}")
operation DeleteItem {
    input: DeleteItemInput
}

structure GetItemInput {
    @httpLabel
    item_id: String
}

structure GetItemOutput {
    item: Item
}

structure ListItemsInput {}

structure ListItemsOutput {
    items: ItemList
}

structure PutItemInput {
    item: Item
}

structure PutItemOutput {}

structure DeleteItemInput {
    @httpLabel
    item_id: String
}

structure Item {
    item_id: String
    display_name: String
    qty: Integer
    supplier_api_key: String
}

list ItemList {
    member: Item
}
