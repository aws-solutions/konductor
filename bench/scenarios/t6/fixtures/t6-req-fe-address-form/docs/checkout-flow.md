# Checkout flow, working copy

1. Customer reaches the address step after choosing delivery.
2. The form restores values from the in-memory checkout draft when the back link is used.
3. Client validation runs before the submit request. Server validation remains authoritative.
4. A successful address moves the customer to delivery options.

The back link must not lose a selected country. The current UI has no loading or retry state for address suggestions. The delivery service rejects a blank country and a blank postal code, but the UI's messages are generic.
