# Refund request acceptance criteria

These criteria turn the refund request feature note into observable behavior for customer, support, and finance test cases.

## Out of scope: notes

The criteria do not define payment-provider settlement timing or the wording of the customer's refund reason.

## Records: notes

* **Given** a refund request or decision is made, **when** the event is saved, **then** the system writes an audit log entry with the order, actor, action, and timestamp.
* **Given** a refund audit record exists, **then** it remains available for **7 years** for support and compliance review.

## Review and customer communication: notes

* **Given** the calculated refund is above **$500**, **when** the request is submitted, **then** **Finance Operations** must approve it before the refund is issued.
* **Given** a request is approved or rejected, **when** the decision is recorded, **then** the customer receives an email within **15 minutes** that states the decision.
* **Given** a customer opens order history after a decision, **then** the page shows whether the refund was approved or rejected and the resulting amount.

## Eligibility and amount: notes

* **Given** an order was delivered, **when** the customer submits a refund request within **30 calendar days** of delivery, **then** the request is accepted for review.
* **Given** the customer submits a request after **30 calendar days**, **then** the request is refused and the customer sees the reason.
* **Given** an order contains a bundle, **when** the customer requests a refund, **then** the customer can select an **individual item** and the refund covers that item's allocated bundle price rather than the whole bundle.
* **Given** the order used coupon **SAVE10**, **when** a refund is calculated, **then** the refunded amount excludes the coupon discount and the coupon is not restored.
