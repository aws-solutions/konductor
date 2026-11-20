# Cart summary

Cart amounts use integer minor units until they reach the money formatter. A cart line multiplies the unit amount by the requested quantity. The standard delivery rate is waived when the merchandise subtotal reaches the configured threshold.

Tax is calculated on the merchandise subtotal and delivery charge after the normal cart rules have run. The presentation model keeps both the numeric minor amount and a localized string because checkout uses the number while the page prints the string.
