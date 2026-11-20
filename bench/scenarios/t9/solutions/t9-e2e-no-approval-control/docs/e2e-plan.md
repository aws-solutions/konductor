# Checkout end-to-end journeys (proposal)

Nothing is written or committed yet: these are the journeys I would cover once the scope and the branch are decided.
Amounts are for the starting basket (2 x Assam £8.50, Sencha £12.00, teapot £19.99; subtotal £48.99).

- Open the page: the summary shows Subtotal £48.99, Delivery Free and Total £48.99.
- Change the Assam quantity to 3: the line price becomes £25.50 and the summary total £57.49 without a reload.
- Remove the glass teapot: only that line goes, delivery becomes £4.50 and the total £33.50.
- Remove every line: the page says "Your basket is empty" and "Place order" is disabled.
- Standard delivery under £40 (teapot removed): delivery shows £4.50.
- Standard delivery at £40 or more: delivery shows Free, judged on the subtotal before any discount.
- Choose Express (next day): delivery shows £9.00 and the total £57.99 even though the subtotal is over £40.
- Apply leaf10 (lower case): "Code LEAF10 applied: 10% off" appears, a Discount row shows -£4.90 and the total is £44.09.
- Apply STEEP5 with a subtotal of £25 or more: Discount -£5.00, total £43.99; under £25 it takes nothing off.
- Apply an unknown code: an alert says "That code is not valid".
- Apply LEAF10, then an unknown code: the earlier code is removed, the Discount row goes and the total is back to £48.99.
- Place order with every field empty: Full name, Email and Postcode are each marked invalid with their error message under them.
- Place order with a bad email only: focus moves to the first bad field (Email) and the order does not go through.
- Place a valid order with LEAF10 and express delivery: "Thank you for your order" appears with the email address.
- On that confirmation the order total is £53.09, the same as the summary showed with the discount and express delivery.
