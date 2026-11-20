# Stockroom

Stockroom is a dependency-free Node.js 24 library and command-line program for tracking warehouse stock. It parses a compact catalog, applies signed stock movements, calculates inventory value, and renders a text table.

Run the tests with:

```sh
npm test
```

The CLI reads JSON from standard input. The JSON object has a `catalog` string with one `SKU, name, unit price, reorder point` row per line and an optional `movements` array containing `{ "sku": "...", "quantity": 4 }` objects.
