## Proposed browser journeys for checkout

Scope and branch are still open, so this is a list only. Prices assume the default basket.

### Order and confirmation
- A complete order with STEEP5 applied and Express chosen ends on "Thank you for your order", which repeats the shopper's email.
- That confirmation's order total reads £52.99, matching the summary total shown before placing it with the discount and express delivery.
- Submitting the details form blank flags Full name, Email and Postcode as invalid, each with its own error message.
- A bad postcode with the other fields fine: focus jumps to the first invalid field and no confirmation appears.

### Codes
- Entering steep5 takes £5 off because the subtotal is above £25; a basket below £25 gets £0 off.
- LEAF10 gives 10% off: the Discount row reads -£4.90.
- A made-up code shows "That code is not valid" as an alert.
- After STEEP5 is accepted, typing a made-up code means the previous code is dropped and the discount row disappears.

### Delivery
- With the teapot gone the subtotal is £29.00, so standard delivery costs £4.50.
- The full basket is over £40, so standard delivery is Free (the discount does not count against the threshold).
- Express always costs £9.00.

### Basket
- Setting the Sencha quantity to 2 updates its line price to £24.00 and the summary total to £60.99.
- Remove the Sencha line: it is gone, the other two stay, and the summary total drops by £12.00.
- After removing all three lines the page shows "Your basket is empty" and Place order is disabled.
