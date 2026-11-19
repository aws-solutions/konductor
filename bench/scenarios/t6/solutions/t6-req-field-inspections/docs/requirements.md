# Field inspection tablet app requirements

## Purpose and release boundary

The app replaces the paper inspection form for Northmere Water Utility field crews. The first release must let a crew select an existing asset, capture a visit in the field, preserve evidence, and hand a completed or stopped visit to the field lead and Records. It must not create new assets or silently discard a visit.

## Requirements

- **R1 — Supported assets and route selection.** The app must offer active assets from the approved asset register, show asset tag, type, site, and access point, and exclude temporary or retired tags from normal route selection. It must retain the asset identity used for the visit even if the route is later reassigned.
- **R2 — Paper-form capture.** For each visit the app must capture an inspection reference, asset tag and type, site and access point, inspector and crew, visit date, arrival and departure times, condition code, observations, corrective action or work-order reference, evidence references, and the reason evidence was not captured. It must distinguish a reading that is not applicable from a missed or blank reading rather than treating either as zero.
- **R3 — Managed device compatibility.** The supported device is a managed rugged Android tablet running Android 13 or later, with an 8-inch screen. The app must operate under the utility MDM, use the managed update channel, require no administrator access, and respect an MDM wipe of local app data.
- **R4 — Offline capture and recovery.** The app must support 8 hours of inspection work offline. It must save the form and captured photos locally, show that the visit is waiting for connectivity, and queue submissions and attachments for resumable upload when a connection returns. A failed attachment must not require the crew to resubmit the whole form.
- **R5 — Shared tablet handoff.** The app must support 12 rugged tablets shared across crews. At sign-out, the worker must choose or confirm the tablet's asset tag, and the workflow must not require a personal device. The app must make unsent work and the current tablet identity visible before a device changes hands.
- **R6 — Evidence and privacy.** The app must allow at most 4 photos per inspection item, preserve each photo at its original resolution, and warn or block before capturing identifiable people or vehicle plates. Each accepted photo must remain linked to the inspection item and asset through upload and archive export.
- **R7 — Concurrent edits.** If two tablets edit the same inspection while disconnected, the app must retain both versions, flag the inspection for field-lead resolution, and never silently overwrite either submission. The lead's resolution must be recorded as an audit event.
- **R8 — Attestation, lead approval, and export.** An inspection is incomplete until the inspector attests on the tablet and the field lead approves it within 2 business days. The field-lead approval is the export gate; the system must show the pending approval and retain both attestation and approval events.
- **R9 — Safety stop.** A chlorine smell, exposed electrical conductor, or unstable ground must trigger a safety-stop status. The app must let the inspector stop the inspection, move clear, and notify the field lead without requiring a reading or photo first. The stopped visit must remain visible to the lead even when normal condition fields are blank.
- **R10 — Records and corrections.** Completed inspection records and their audit history must be retained for 7 years from completion. Corrections must create a new audit event while keeping the original submitted value recoverable, and a legal hold must suspend normal disposal. Exports must preserve inspection, asset, event-time, worker, review-event, and attachment relationships with timezone information.
- **R11 — Inspection identity and upload state.** The app must assign a stable inspection reference when a form is first saved, including when it is saved away from the depot. It must show local-save, waiting-for-connection, upload-complete, and upload-failed states and allow an interrupted upload to resume.
- **R12 — Review and exception visibility.** The lead must be able to find visits by asset and see stopped visits, pending approvals, upload failures, corrections, and conflict flags. A stopped visit must not be labelled as an ordinary failed condition check.

## Open points and assumptions

- The initial pilot asset list and the date for expanding beyond it are not approved in the source material; this document assumes the route list is configurable and keeps that scope decision open.
- The utility has not selected a replacement tablet model; Android 13+, the 8-inch standard, rugged hardware, and MDM controls are the compatibility boundary.
- The field lead is treated as the approver and conflict resolver for this release. Records should confirm whether a delegate can perform either action.
- Safety should confirm the maintained hazard vocabulary and the final notification wording before build completion.
- Records and Operations should confirm the correction permissions, device-return checklist, and archive export contract during delivery.

```json
{
  "requirements": [
    { "id": "R1", "text": "The app must offer active assets from the approved asset register, show asset identity, and exclude temporary or retired tags from normal route selection." },
    { "id": "R2", "text": "For each visit, capture the paper-form fields and distinguish a reading that is not applicable from a missed or blank reading." },
    { "id": "R3", "text": "Support a managed rugged Android tablet running Android 13 or later with an 8-inch screen and utility MDM controls." },
    { "id": "R4", "text": "Support 8 hours of offline work, save forms and photos locally, and queue submissions and attachments for resumable upload when connectivity returns." },
    { "id": "R5", "text": "Support 12 rugged tablets shared across crews, identify the tablet by asset tag at sign-out, and require no personal device." },
    { "id": "R6", "text": "Allow at most 4 photos per inspection item, preserve original resolution, and warn or block identifiable people or vehicle plates." },
    { "id": "R7", "text": "For concurrent offline edits, retain both versions, flag the record for field-lead resolution, and never silently overwrite either submission." },
    { "id": "R8", "text": "Require inspector attestation and field lead approval within 2 business days, with lead approval as the export gate." },
    { "id": "R9", "text": "A chlorine smell, exposed electrical conductor, or unstable ground must trigger a safety-stop status that can be saved without a reading or photo." },
    { "id": "R10", "text": "Retain completed records and audit history for 7 years, keep original values recoverable through corrections, honor legal holds, and preserve attachment and timezone relationships in export." },
    { "id": "R11", "text": "Assign a stable inspection reference at first save and show resumable upload states." },
    { "id": "R12", "text": "Give the field lead visibility into stopped visits, pending approvals, failures, corrections, and conflict flags." }
  ],
  "assumptions": [
    "The initial pilot asset list remains configurable because the source material does not approve a final list.",
    "Android 13+, an 8-inch rugged tablet, and utility MDM are the compatibility boundary rather than a selected purchase model.",
    "The field lead is the default approver and conflict resolver until Records confirms delegation rules.",
    "Safety will confirm the maintained hazard vocabulary and final notification wording before build completion.",
    "Records and Operations will confirm correction permissions, device-return checks, and the archive export contract during delivery."
  ]
}
```
