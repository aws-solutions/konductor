# Operations notes

The service layer has no HTTP listener. Applications create a `CartStore`, add
items, and pass a cart to `calculateOrderTotal`. Restarting the process clears
in-memory carts. Catalog validation is a separate lightweight command.
