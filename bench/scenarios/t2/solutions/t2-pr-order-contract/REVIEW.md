# Review of PR 2231

## Verdict

Request changes before merge. The response and queue edits break contracts used by still-supported clients and the shipping consumer. The update path also creates a partial-write window, and the new diagnostic endpoint exposes customer data to any caller.

## Findings

### `src/routes/debug-route.js:13` critical

The new public route serializes the full customer record, which includes the email address, and `src/server.js` registers it without any authentication or authorization check. Remove this route from the public server or protect it with the service's auth middleware and return a deliberately redacted diagnostic shape.

### `src/serialization/order-view.js:12` high

`displayTotal` is replaced by `total` with no compatibility alias. The mobile contract says app versions 7 and 8 read `displayTotal` directly, so those clients will show no amount while they remain in use. Keep `displayTotal` as an alias during the migration or version the response.

### `src/routes/orders-route.js:13` high

The update handler now requires `deliveryNote`, although the mobile client omits that optional field when there is no note. Older app versions will receive 400 responses for otherwise valid updates. Keep delivery note optional for this route or introduce a versioned request contract.

### `src/serialization/order-status.js:3` high

Removing `paused` from the readable status set makes `toOrderResponse` throw for existing stored orders with that status. Preserve the paused legacy status until stored rows have been migrated, then remove it in a separate contract change.

### `src/events/order-events.js:16` high

The published `order.updated` message changes `sequence` from an integer to a string. The shipping consumer compares this field numerically, so string comparisons can accept an older update after a newer one. Keep sequence numeric in the published payload.

### `src/routes/orders-route.js:24` high

The order is saved before its items are replaced. If the item write fails, the new order revision remains beside the old item set. Use an atomic transaction or restore the previous order when the item write fails.

### `src/validation/order-input.js:8` medium

The new currency check only verifies that the value is a string, while `OrderStore.save` and the production data shape require a three-letter uppercase code. Validate the currency code at the request boundary before attempting persistence.

```json
[
  {
    "location": "src/serialization/order-view.js:12",
    "severity": "high",
    "issue": "Replacing displayTotal without an alias breaks the response contract for mobile app versions 7 and 8 that still read displayTotal.",
    "fix": "Keep a displayTotal alias for backward compatibility while the old clients remain supported."
  },
  {
    "location": "src/routes/orders-route.js:13",
    "severity": "high",
    "issue": "The update route makes deliveryNote required even though older mobile clients omit that optional field, so valid updates receive 400 responses.",
    "fix": "Keep delivery note optional for updates or version the request contract."
  },
  {
    "location": "src/serialization/order-status.js:3",
    "severity": "high",
    "issue": "Filtering out paused makes response serialization throw when an old stored order still carries that legacy status.",
    "fix": "Preserve paused until the stored orders are migrated."
  },
  {
    "location": "src/events/order-events.js:16",
    "severity": "high",
    "issue": "The queue payload changes sequence from an integer to a string even though shipping compares it numerically.",
    "fix": "Keep sequence numeric in the published event."
  },
  {
    "location": "src/validation/order-input.js:8",
    "severity": "medium",
    "issue": "Currency accepts any string even though the store column requires a three-letter uppercase currency code.",
    "fix": "Validate a three-letter currency code before persistence."
  },
  {
    "location": "src/routes/orders-route.js:24",
    "severity": "high",
    "issue": "Saving the order and replacing its items in separate writes can leave a new order revision paired with old items after an item-write failure.",
    "fix": "Wrap both writes in an atomic transaction with rollback."
  },
  {
    "location": "src/routes/debug-route.js:13",
    "severity": "critical",
    "issue": "The public debug route returns the complete customer record, including email, without authentication or authorization.",
    "fix": "Require authentication and authorization, or redact email from the diagnostic response."
  }
]
```
