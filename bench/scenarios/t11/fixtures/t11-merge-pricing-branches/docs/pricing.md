# Pricing notes

The quote is calculated from the unrounded cart values. A discount reduces the
basket before tax is calculated. Shipping is added after the basket discount.
The tax region decides whether shipping joins the taxable base. The final
amounts are represented in cents using half-up rounding.

An empty cart has a zero subtotal and still receives the selected shipping
charge. A caller that needs a free delivery promise should choose that rule
before calling this package.

Currency rounding is half-up and happens after the basket arithmetic, rather
than once for every individual cart line.
