# Checkout flow

The page starts with the saved cart, then asks for delivery details and payment. The gateway adapter accepts a small request object and returns an order reference. The status panel checks progress until the gateway reports a final state.

The browser page has no build step and should remain usable if the catalog service is unavailable. In that case the local sample catalog is shown and a clear message lets a shopper try again.
