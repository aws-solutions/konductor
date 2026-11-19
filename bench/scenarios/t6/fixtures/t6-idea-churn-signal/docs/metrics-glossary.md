# Metrics glossary

**Lost subscriber:** June dashboard category for a subscription that ended or lost access after an unpaid invoice, using a seven-day look-forward.

**Voluntary cancellation:** A subscription that reached `subscription_ended` after a member's cancellation request while the invoice was paid or current.

**Failed-payment loss:** A subscription that had a failed card event and no successful payment within seven days before the relationship ended.

**Recovery:** A payment that posts within seven days of a failed event. A manual payment is a recovery event, not an automated retry.

**Cancellation-start event:** A product event emitted when the member opens the cancellation flow. The June 10–16 event stream is incomplete.
