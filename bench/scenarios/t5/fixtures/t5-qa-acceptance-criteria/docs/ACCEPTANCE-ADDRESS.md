# Delivery address acceptance criteria

## Criteria

- **Given** a customer edits a delivery address before dispatch, **when** the address passes validation, **then** the order uses the saved address.
- **Given** a required address field is missing, **when** the customer saves the form, **then** the form identifies that field.
- **Given** an order has been dispatched, **when** the customer opens address details, **then** the page shows whether changes are still available.

## Notes

The address service owns postal-code rules. The shop records the selected address with the order.
