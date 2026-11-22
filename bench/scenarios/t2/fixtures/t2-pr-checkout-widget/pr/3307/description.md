# Add checkout summary and promotion entry

The checkout page now shows its line items, total, promotion entry, and order action in one summary widget. This keeps checkout composition in one browser module and gives the page a small service seam for promotion and order requests.

The widget also adds the checkout-specific stylesheet, supplies a useful status region for service replies, and removes old helpers that no longer had callers. The existing currency and cart helpers remain available to other pages.

Tested with `node --test` on Node.js 24. The suite covers total calculation, line labels, the order client, and existing cart and currency behavior.
