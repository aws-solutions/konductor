# Customer refund policy excerpt

Annual-plan customers may request a refund within seven calendar days of payment. Finance posts the refund against the original order and sends a nightly file to Analytics. The payment-success event remains in the product event stream after a refund, so analysts must use `refund_7d` when reporting retained paid orders.
