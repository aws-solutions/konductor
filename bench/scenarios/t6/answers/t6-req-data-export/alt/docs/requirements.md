# Self-service account data export requirements

## Product requirements: notes

* The account owner or a user assigned the **Account Data Export** permission may submit a request. A Northstar support agent cannot submit an export for a customer.
* Self-service export is available on **Pro and Enterprise** plans. Starter accounts do not receive this self-service flow and remain on the existing support path.
* The service allows only one active long-running export or archive job per account. A later request must show a clear queued or rejected state rather than creating concurrent archive jobs.
* The archive must include account metadata, users, appointments including cancelled records, availability rules, rooms, custom fields, and enabled integrations. The export scope must keep the account's records together and retain the source record identifiers needed for migration.
* The archive must exclude payment card data, Northstar internal support notes, and deleted appointments or other records deleted before the export request. Customer-visible appointment records, including cancelled appointments, remain in scope.
* The result is a ZIP archive containing CSV data files and a JSON manifest. The manifest identifies the account, request, included files, and completion state. The archive's exported date-time values use UTC with a trailing `Z`; source time-zone context is retained where the record has it.
* Processing must start within **15 minutes** of a valid request, and the completed package must be available within **72 hours** of that request. The job status must show queued, running, ready, or failed state.
* The customer receives a signed download link after the package is ready. The signed download link expires **7 days** after readiness; after expiry, the customer must submit a new request.
* The compressed archive must not exceed **2 GB**. If the package would exceed that limit, the product must stop the self-service download path and direct the customer to Support instead of silently splitting the archive.
* The export request and its outcome must be visible in the account activity view without exposing package contents. The UI must identify the requester and request status.
* The immutable audit log must record `export.requested`, `export.ready`, `export.downloaded`, and `export.expired` events and retain those events for **400 days**. Failed requests should also carry a failure event or status that operators can investigate without downloading customer content.
* Generated packages must use the existing encrypted object-storage controls and must be deleted when the signed-link lifetime ends. A package must never be addressable by a user from another tenant.

## Scope: notes

The feature lets eligible customers request a background archive of the Northstar account from the admin console. It must preserve tenant isolation, make progress visible, and give the customer a controlled browser download rather than an email attachment.

The archive covers account metadata, users, appointments including cancelled appointments, availability rules, rooms, custom fields, and enabled integrations. It must not expose secrets, credentials, or information belonging to another tenant.

## Assumptions and open points: notes

* Open point resolved for this draft: the Account Data Export permission is a distinct permission that Owners can grant to selected users.
* Open point resolved for this draft: the first release uses the existing admin console and background job service, not a public migration API.
* Open point resolved for this draft: Support handles archives over the compressed size limit and Starter requests through the current manual process.
* Open point for implementation review: the endpoint's exact queued-versus-rejected response for a second active request still needs an API decision.
* Open point for implementation review: privacy and security owners must approve the final event schema and deletion behavior before launch.

```json
{
    "assumptions": [
        "Account Data Export is a grantable permission distinct from the built-in Owner role.",
        "The first release uses the existing admin console, activity view, background worker, and encrypted object storage.",
        "Support remains the path for Starter accounts and archives above the compressed size limit.",
        "The API behavior for a second active request and the final event schema remain implementation review points."
    ],
    "requirements": [
        {
            "text": "Only an account owner or a user with the Account Data Export permission may submit an account export request; Northstar support agents cannot submit one for a customer.",
            "id": "R1"
        },
        {
            "text": "Self-service export is available on Pro and Enterprise plans, not Starter.",
            "id": "R2"
        },
        {
            "text": "An account may have only one active long-running export or archive job; a later request must show a queued or rejected state.",
            "id": "R3"
        },
        {
            "text": "The archive includes account metadata, users, appointments including cancelled appointments, availability rules, rooms, custom fields, and enabled integrations, while keeping tenant records together.",
            "id": "R4"
        },
        {
            "text": "The archive excludes payment card data, Northstar internal support notes, and deleted appointments or other records deleted before the request; customer-visible cancelled appointments remain included.",
            "id": "R5"
        },
        {
            "text": "The result is a ZIP archive containing CSV data files and a JSON manifest; its exported date-time values use UTC with a trailing Z.",
            "id": "R6"
        },
        {
            "text": "Exported date-time values use UTC with a trailing Z and retain source time-zone context where available.",
            "id": "R7"
        },
        {
            "text": "Processing starts within 15 minutes of a valid request and the completed package is available within 72 hours.",
            "id": "R8"
        },
        {
            "text": "The signed download link expires 7 days after the package is ready; after expiry, the customer must submit a new request.",
            "id": "R9"
        },
        {
            "text": "The compressed archive limit is 2 GB; an oversized package is routed to Support rather than silently split.",
            "id": "R10"
        },
        {
            "text": "The immutable audit log records export.requested, export.ready, export.downloaded, and export.expired events and retains them for 400 days.",
            "id": "R11"
        },
        {
            "text": "The archive never exposes secrets or credentials and never contains another tenant's information.",
            "id": "R12"
        }
    ]
}
```
