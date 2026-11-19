# Payment method acceptance criteria

## Criteria

- **Given** a signed-in customer has a valid card, **when** the customer saves it, **then** the payment method appears in the wallet.
- **Given** a card is expired, **when** the customer tries to pay, **then** checkout explains that another method is needed.
- **Given** a payment succeeds, **when** the order is created, **then** the order shows the payment status.

## Notes

Payment credentials are handled by the payment provider. This document covers the shop's visible states only.
