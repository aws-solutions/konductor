# Clean up the product payload

## What changed

This PR trims a few repeated payload names, adds the warehouse note used by the fulfillment export, and keeps the create and response schemas aligned with the service code. Product change events now use the display form of the price. The API description and focused tests were refreshed with the new shape.

## Why

The catalog payload has accumulated names that are longer than the labels used by the warehouse and mobile teams. This pass makes the common response easier to read and gives callers a stable place for an operational note.

## How it was tested

- `node --test`
- Manual read of `p-100` through the catalog service
- Schema files loaded by the schema tests
