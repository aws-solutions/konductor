# Northstar Checkout

Northstar Checkout is a small, dependency-free checkout page for the Northstar Supply storefront. It is served as static files so the same build can run from a preview bucket or a local file server.

## Local work

Use a recent Node release and run `npm test`. To preview the page, serve this directory with any static HTTP server and open `index.html`.

The browser code uses the JSON catalog in `data/` and the checkout gateway adapter in `src/api/checkout-api.js`. The test suite deliberately keeps DOM orchestration out of Node and covers the calculations and state transitions behind it.

## Release notes

The checkout owns its visible cart, delivery, payment, and order-progress panels. Copy and sample products live in data files so a content edit does not require a JavaScript change.
