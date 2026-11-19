# Address step notes

Owner: Jo Venn, frontend
Last edited: 2025-01-18

The current step grew from a shipping-only form. The country select is first, followed by address line one, address line two, city, region, and postal code. For US and CA the region label is State / province. For GB the old copy says County, even though the field is optional in the service payload.

The lookup control was added behind a flag and is not enabled for every country. When it returns nothing, people need a calm path back to the fields. Do not clear values when a suggestion is dismissed. There is no agreed response for a provider outage.

The UI uses the browser's native labels but the error summary does not currently move focus. The keyboard order follows the DOM. The mobile CSS collapses the two-column rows at 36rem, though the notes from the field study call that a rough cutoff rather than a product promise.

Open points from the design review: address lines and organization are still being discussed; whether a PO box is acceptable depends on fulfilment; and the form's saved-address behavior is not implemented here.
