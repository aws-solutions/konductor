The payload cleanup is not ready to merge. It changes data exchanged with mobile clients and the search indexer without preserving the contracts those callers currently use. It also weakens request validation in two places and leaves the public request description behind the schema.

- `src/catalog/product-service.js:8` renames `displayName` to `label` and drops the old property. Mobile releases 4.8 and 4.9 still read `displayName`, so they will show blank titles. Keep `displayName` as a compatibility alias, or version the response and coordinate the client migration.
- `schemas/product-create.json:7` adds `subtitle` to the required list even though create requests have historically omitted it and the normalizer supplies an empty value. Keep it optional by removing it from `required`.
- `src/catalog/normalizers.js:1` removes `archived` from the accepted status enum. `data/products.json` contains an archived product, so reading that row now throws. Restore `archived` to the enum and keep it in the response schema.
- `src/events/product-changed.js:15` formats `priceCents` with `toFixed(2)`, changing it from an integer to a string. The search indexer rejects non-numeric prices. Emit integer cents, and keep the event schema and consumer contract aligned.
- `schemas/product-create.json:13` removes the `maxItems: 12` bound from `labels`, while `config/limits.json` says the store column holds twelve values. Restore the array limit and reject oversized requests before persistence.
- `schemas/product-create.json:18` removes `additionalProperties: false` from the nested `attributes` object. Unknown keys will now pass validation and be stored silently. Restore the restriction.
- `docs/api/catalog.yaml:28` does not describe the new required `subtitle` request field. Update the API contract with the required field and an example so callers see the same requirement as the schema.

```json
[
  {
    "location": "src/catalog/product-service.js:8",
    "severity": "high",
    "issue": "The response mapper replaces displayName with label, but mobile releases 4.8 and 4.9 still read displayName and will show blank product titles.",
    "fix": "Keep displayName as a compatibility alias or version the response before removing the old field."
  },
  {
    "location": "schemas/product-create.json:7",
    "severity": "high",
    "issue": "subtitle changed from optional to required even though existing callers may omit it and the normalizer supplies an empty value.",
    "fix": "Remove subtitle from the required list and keep it optional."
  },
  {
    "location": "src/catalog/normalizers.js:1",
    "severity": "critical",
    "issue": "Removing archived from the accepted status enum makes reads of the archived product in data/products.json throw.",
    "fix": "Restore archived to the enum and response schema."
  },
  {
    "location": "src/events/product-changed.js:15",
    "severity": "high",
    "issue": "priceCents is now emitted as a decimal string, but the search indexer accepts only a finite number and will reject the event.",
    "fix": "Keep priceCents as integer cents and align the event schema with the consumer."
  },
  {
    "location": "schemas/product-create.json:13",
    "severity": "medium",
    "issue": "The labels array has no maximum even though the store limit is twelve values, so an oversized request can reach a bounded column.",
    "fix": "Restore maxItems: 12 to the labels array."
  },
  {
    "location": "schemas/product-create.json:18",
    "severity": "medium",
    "issue": "The nested attributes object accepts unknown keys after additionalProperties: false was removed, so misspellings pass silently into storage.",
    "fix": "Restore additionalProperties: false and reject unknown nested keys."
  },
  {
    "location": "docs/api/catalog.yaml:28",
    "severity": "medium",
    "issue": "The API documentation does not state that subtitle is required, so callers will see a stale request contract.",
    "fix": "Document subtitle as a required field and add a request example."
  }
]
```