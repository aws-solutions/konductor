# Pricing notes

The quote starts with the unrounded cart values. A recognized basket offer is
subtracted before tax is calculated. Shipping is added after the discount, and
the tax region decides whether shipping joins the taxable base.

Meadow is a zero-rate region and excludes shipping from its tax base.

The final amounts use half-up cent rounding. Basket arithmetic keeps its
fractional cents until the end, so two lines are not rounded independently.
The optional `promoCode` field selects an offer from the JSON configuration.
