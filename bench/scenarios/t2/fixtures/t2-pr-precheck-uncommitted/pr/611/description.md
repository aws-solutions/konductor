# Improve quote cache visibility and carrier diagnostics

This change makes the quote path easier to operate while keeping the public response shape stable. It adds a small set of carrier request helpers, records response timing, exposes a compact configuration view, and documents the current weight examples. The quote service now has a neutral response for a carrier outage so callers can continue to render a checkout result.

The cache key follows the address fields already used by the quote service. The new tests cover a second destination, carrier availability, supported weights, and response source handling.

I ran `node --test` on Node.js 24. All 18 tests pass.
