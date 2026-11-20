# Checkout address form requirements

These requirements describe the first release of the redesigned address step. They separate behavior that can be built and checked from decisions that still need an owner.

### R11. Make errors recoverable: notes
Use the existing labels and generic required and invalid-postal messages unless approved copy replaces them. Keep entered values after a failed lookup or failed submit, associate each inline message with its field, and expose all failed fields through a keyboard-reachable error summary. A no-results state must offer manual entry.

### R10. Keep address data out of logs: notes
Client diagnostics may record field names and validation outcomes, but must not log complete address values, lookup responses, or postal codes. Error messages must not copy a provider response. Analytics must use the existing checkout identifiers and the payload contract in the event list.

### R9. Support reliable browser autofill: notes
Use the browser autocomplete tokens for name, organization, address-line1, address-line2, address-level2, address-level1, postal-code, and country. Keep each token on the matching named input so browser autofill does not depend on placeholder text. Lookup selection must not overwrite a manually entered apartment or unit without an explicit customer action.

### R8. Define the PO-box rule: notes
Permit PO boxes for the United States and Canada. Reject PO boxes for the United Kingdom with an actionable message explaining that a street address is required. Keep the rule separate from the generic postal-format error and do not silently rewrite the customer's address.

### R7. Work on small screens: notes
The form must work at a 360px-wide viewport without horizontal scrolling. Use a single-column layout when the available width requires it, make primary controls and other touch targets at least 48px tall, and scroll or reposition the active field so the mobile keyboard does not hide its label, value, or error.

### R6. Preserve analytics exactly: notes
Keep the existing `checkout_address_viewed`, `checkout_address_submitted`, and `checkout_address_lookup_used` event names and payload keys unchanged. Fire each event once for its matching action, with no duplicate event from blur, lookup retries, or error rendering. Do not send complete address values in analytics.

### R5. Meet the accessibility commitment: notes
The address step must meet WCAG 2.2 AA. Every input needs a real visible label, a programmatic error association, visible focus, and a logical keyboard order. On failed submission, focus must reach the error summary, which must link to each invalid field and must not rely on color alone.

### R4. Provide bounded address lookup: notes
Use the ParcelPin Lookup v2 service for supported countries. Allow at most 3 lookup requests in one checkout session. After the limit or a provider failure, keep the manual entry path available and do not block checkout. A suggestion may populate fields only after an explicit customer choice, and it must not overwrite a manually entered unit without a clear action.

### R3. Apply country-specific postal validation: notes
The browser must accept a US ZIP code with five digits or five digits plus a hyphen and four digits, accept the Canadian A1A 1A1 format, and use the current UK outward/inward postcode pattern. Run the format check when the postal-code field is blurred, while keeping server validation authoritative. Show the existing invalid-postal message beside the field and in the error summary when appropriate.

### R2. Limit the launch country set: notes
For the first release, the country selector and address rules must support only the United States, Canada, and the United Kingdom. Australia is excluded from the launch set and must not appear as a selectable launch country; it is deferred to a later rollout on 2026-04-15.

### R1. Preserve the checkout address model: notes
The form must retain country, address line 1, an optional second address line, city, region or state/province, and postal code. When the customer uses the back link, it must preserve the selected country and entered values. Lookup selection or dismissal must not clear an apartment or unit value. Submit the original address values after trimming only presentation whitespace, and leave server validation authoritative.

## Requirements: notes

## Assumptions and open points: notes

* Confirm with fulfilment whether any non-street delivery addresses beyond the PO-box rule need a separate policy.
* Confirm the provider outage and retry copy before enabling lookup for all supported countries.
* Confirm whether organization is in scope for delivery and whether it needs a visible required/optional rule.
* Confirm saved-address behavior; it is not implemented in this snapshot.
* Confirm final error copy with support while preserving the field keys and analytics contract.

```json
{
    "assumptions": [
        "Fulfilment will confirm any delivery-address policy beyond the stated PO-box rule.",
        "The lookup provider outage and retry copy remain open before broad enablement.",
        "Organization scope and its required or optional status remain open.",
        "Saved-address behavior is out of scope because it is not implemented in this snapshot.",
        "Support will confirm final error copy without changing field keys or the analytics contract."
    ],
    "requirements": [
        {
            "text": "The form retains country, address line 1, an optional second address line, city, region or state/province, and postal code; it preserves country on back navigation and never clears a manually entered unit during lookup.",
            "id": "R1"
        },
        {
            "text": "The first release supports only the United States, Canada, and the United Kingdom; Australia is excluded from the launch set and deferred until 2026-04-15.",
            "id": "R2"
        },
        {
            "text": "The US ZIP accepts five digits or five digits plus a hyphen and four digits; Canada uses A1A 1A1; the UK uses the current outward/inward pattern. Run validation on blur and leave server validation authoritative.",
            "id": "R3"
        },
        {
            "text": "Use ParcelPin Lookup v2 with at most 3 lookup requests per checkout session; after the limit or a failure, keep manual entry available and do not block checkout.",
            "id": "R4"
        },
        {
            "text": "The address step meets WCAG 2.2 AA with programmatic field errors, and failed submission moves focus to an associated error summary.",
            "id": "R5"
        },
        {
            "text": "Keep checkout_address_viewed, checkout_address_submitted, and checkout_address_lookup_used with their payload keys unchanged, and fire each event once for its matching action.",
            "id": "R6"
        },
        {
            "text": "The form works at a 360px-wide viewport without horizontal scrolling, uses touch targets at least 48px tall, and keeps the mobile keyboard from hiding the active error.",
            "id": "R7"
        },
        {
            "text": "Permit PO boxes for the United States and Canada but reject them for the United Kingdom with an actionable explanation that a street address is required.",
            "id": "R8"
        },
        {
            "text": "Use browser autofill or autocomplete tokens for name, organization, address-line1, address-line2, address-level2, address-level1, postal-code, and country; lookup selection must not overwrite a manually entered unit.",
            "id": "R9"
        },
        {
            "text": "Client diagnostics must not log complete address values, lookup responses, or postal codes; analytics must use the existing identifiers and payload contract.",
            "id": "R10"
        },
        {
            "text": "Retain the existing address line 1, optional second line, city, region, postal code, and country values after errors, associate messages with fields, and offer manual entry after no lookup results.",
            "id": "R11"
        }
    ]
}
```
