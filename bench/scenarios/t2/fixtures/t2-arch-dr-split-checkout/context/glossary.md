# Glossary

**Checkout token**: Client-generated opaque value that identifies one submission and is safe to replay.

**Order**: The durable commerce record returned to a customer after the checkout operation reaches a successful state.

**Reservation**: A time-limited hold on inventory for one order. It is not a shipment confirmation.

**Provider authorization**: A payment provider decision that funds may be captured later. An authorization can remain pending after a network timeout.

**Cut-over**: The point at which the selected production caller sends its request to the extracted service rather than the monolith module.

**Primary path**: The implementation whose response is returned to the caller.

**Shadow request**: A non-authoritative request made for comparison; it must not create an order, authorization, or reservation.
