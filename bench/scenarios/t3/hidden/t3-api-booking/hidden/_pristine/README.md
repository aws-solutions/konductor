# Booking API architecture inputs

This folder contains the working notes for the room-booking service. The service will be used by front-desk tools, a member web application, and an integration partner. Treat the JSON files as the current measurements and commercial terms; the Markdown notes explain how the numbers were obtained.

The architecture request covers three operations: find bookings for one room in a date interval, retrieve one booking by identifier, and create a booking safely when a client retries a request. A gateway sits in front of the service, so the public contract must describe the gateway's behavior rather than an internal service shortcut.

The partner migration note records an old contract for context. It is not a current gateway setting. The reliability note and traffic profile describe the production environment; the sandbox values in the operations note are useful only for local smoke tests.

Do not assume that a larger page is better. A page needs to fit the public response envelope while leaving room for JSON structure and future fields. The price sheet is a planning estimate, not an invoice.
