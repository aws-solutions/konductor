# Add checkout reservation holds

Checkout now has a short-lived hold that keeps requested units attached to a
basket while payment is completed. Holds can be released directly or cleaned
up by the sweep endpoint, and the event stream receives hold lifecycle events.
The in-memory store has the new records and the router exposes the checkout
paths.

I tested the new service and router cases with `node --test`. The implementation
keeps the existing stock endpoints and event payload style unchanged.
