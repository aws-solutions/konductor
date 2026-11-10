# Answer key: adversarial-code-review-pass-schema fixture

Contract/schema defects planted in change.diff (line numbers in new files):
- src/schema.js:3 - status SHIPPED renamed to DISPATCHED; README says mobile clients switch on status.
- src/schema.js:9 - giftWrap is now required by orderInput (missing -> error); existing v1 clients never send it. Breaking, no migration.
- src/schema.js:18-19 - `total` removed from toOrderResponse (shipped v1 field), `region` added.
- src/repo/orderRepo.js:9 - item.region.toUpperCase() with no default; existing records lack region -> TypeError on read.
- src/consumers/orderQueue.js:5-7 - orderInput validation removed from the SQS consumer path; giftWrap/region unvalidated there.
- src/handlers/orders.js:7-8 - new required x-tenant-id header, 400 TENANT_REQUIRED for existing clients.
- src/handlers/orders.js:15 - error code ORDER_NOT_FOUND renamed to NOT_FOUND (clients switch on code).
- src/handlers/orders.js:20-21 - markCancelled (side effect) runs before reason validation; src/routes.js:13 new route has no validate() middleware.
Out of scope for this pass: security/integrity issues (none planted on purpose).
