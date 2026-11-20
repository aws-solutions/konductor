# Checkout rules

Written with the shop team, March. Amounts are in pence in code and in pounds on the page.

## Basket

Each line shows the product, a quantity box (1 to 9) and the line price. Changing the quantity updates the line
price and the order summary straight away. "Remove" takes the line out. When the last line goes, the page says
"Your basket is empty" and the "Place order" button is disabled.

## Delivery

- Standard (3 to 5 days): £4.50, free when the subtotal is £40 or more. The subtotal is taken before any discount.
- Express (next day): £9.00 always.

The summary shows "Free" when delivery costs nothing.

## Promo codes

Codes are not case-sensitive. A valid code shows a confirmation line and a Discount row in the summary. A code that
does not exist shows "That code is not valid" and removes any code applied before.

| Code | Effect |
| --- | --- |
| LEAF10 | 10% off the subtotal |
| STEEP5 | £5 off when the subtotal is £25 or more |

## Your details

Full name, email and postcode are required. On "Place order" each bad field is marked and gets its message under it,
and focus moves to the first bad field. When everything is valid the page shows "Thank you for your order" with the
email address and the order total.
