# Pricing notes

Cart amounts remain numeric while a quote is assembled. The configured offer
comes off the merchandise total first. Tax is then computed for the delivery
place, with Harbor leaving delivery outside the base and Ridge including it.
Meadow charges no tax and also leaves delivery outside the base. Missing places are rejected so an estimate cannot quietly
use the wrong rate.

Currency fields are rounded half-up after the arithmetic is complete. This
keeps a pair of sub-cent cart lines together instead of rounding each line in
isolation. `promoCode` names an entry in the JSON offers table.
