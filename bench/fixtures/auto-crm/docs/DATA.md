# Data files

All files are JSON, UTF-8. Timestamps are ISO 8601 in UTC.

## data/customers.json

An array of customers: `id`, `name`, `email`, `phone`, `tier` (`basic` or `gold`), `notes`, `createdAt`,
`updatedAt`. `email`, `phone` and `notes` may be an empty string or null when unknown.

Customers are entered by hand at the counter and through the web form, so the same person can appear twice
(different capitalization, stray spaces, a second record created instead of an update). Ids are never reused.

## data/orders.json

An array of orders: `id`, `customerId` (an id from `customers.json`) and `totalCents`.
