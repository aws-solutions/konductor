# Mobile JSON client

The iOS and Android clients decode the order response without a translation layer. App versions 7 and 8 remain in use while version 9 rolls out.

Versions 7 and 8 read `displayTotal`, `deliveryNote`, `status`, `statusLabel`, `items`, and `updatedAt` directly from the response object. A missing property becomes an empty screen value, so the old property stays in the payload until both versions are retired.

The update request sends `customerId`, `total`, `currency`, and `items`. `deliveryNote` is sent when a customer has a note and is omitted otherwise. Clients do not add an empty note merely to satisfy a server-side requirement.
