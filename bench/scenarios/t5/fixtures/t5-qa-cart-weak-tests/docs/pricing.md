# Pricing rules

All prices use integer cents. A subtotal is the sum of each unit price times
its quantity. Discounts are applied in the order supplied by the caller. A
percentage discount rounds its cents reduction to the nearest cent, and a
fixed discount cannot make the remaining subtotal negative.

Tax is calculated on the discounted subtotal. The tax rate is expressed in
basis points, so 825 means 8.25 percent. Tax cents round to the nearest cent.
