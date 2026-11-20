# Appointment reminder requirements

## Confirmed functional requirements: notes

* **R1, local quiet period:** The service must not send appointment texts from **20:00 through 08:00 in each clinic's local time**, including weekends. It must evaluate the clinic timezone attached to the appointment rather than the server clock.
* **R2, reminder schedule:** For an eligible appointment, send **exactly two reminders**, at **72 hours** and **24 hours** before the appointment. If an appointment is booked less than 24 hours before its start, send one reminder immediately rather than trying to recreate the missed schedule.
* **R3, minimum message content:** Each message may include the patient's **first name** and **clinic name** only. It must omit the provider name, treatment type, clinical findings, and **diagnosis**. The approved copy must remain short and must direct patients to the clinic's main phone for changes.
* **R4, languages and fallback:** At launch, approved templates must be available in **English and Spanish**. A patient with any other language preference receives the English template until an approved translation exists; the system must not claim that an untranslated template was sent in the patient's preferred language.
* **R5, automated opt-out:** A reply containing **STOP, END, or UNSUBSCRIBE** must immediately suppress future reminder texts for that phone number and record the communication preference in the patient record. The suppression must apply across clinics when the same number is used for more than one patient record, subject to the data-owner review of duplicate numbers.
* **R6, ordinary replies:** A non-opt-out or ordinary reply must create a **front-desk task** with the clinic and appointment reference. The desk must review it within **60 minutes** during open hours, or by the next opening after hours. The service must not treat an ordinary reply as a booking change or confirmation.
* **R7, rollout sequence:** Launch **Cedar Grove Rehab and Harbor Point Therapy on March 3, 2025**. Add **Northgate Mobility on March 17, 2025**, only after the first two clinics complete a two-week operational check with no unresolved critical issue.
* **R8, consent eligibility:** Send only when the appointment record has an explicit SMS consent value of `yes`. A blank or unknown consent value, a missing mobile number, or a landline must make the appointment ineligible and visible in an exception report.
* **R9, appointment status:** Re-check the booking system before each send. The service must not send reminders for appointments marked `cancelled`. A reschedule must use the new appointment record, and an old cancelled record must not produce a reminder.
* **R10, clinic timezone configuration:** The configuration must include Cedar Grove Rehab, Harbor Point Therapy, and Northgate Mobility with their source-recorded local time zones, and every send decision must use the configured clinic timezone.
* **R11, delivery and audit trail:** Record the appointment reference, clinic, template language, send decision, provider status, and opt-out or reply event without putting clinical details into the SMS log. Report at least queued, sent, delivered, and failed outcomes separately from patient cancellations.
* **R12, pause control:** An authorized operations user must be able to pause one clinic's outbound reminders without pausing the other clinics. A pause must prevent new sends, preserve the reason and actor in the audit trail, and be reversible without a vendor support ticket.

## Purpose and scope: notes

MotionSpring needs a clinic-aware SMS reminder service that reduces avoidable missed visits without exposing clinical information or creating an unowned front-desk queue. The booking system remains the source of truth for appointment status. The first release covers appointment reminders, delivery status, opt-out handling, inbound replies, a clinic-level pause control, and a basic outcome report. It does not send billing, marketing, or clinical follow-up messages.

## Open points and assumptions: notes

* Compliance must approve the final English and Spanish copy and confirm that the first-name and clinic-name fields satisfy the privacy policy before any patient-facing send.
* The team still needs the vendor's written reply-handling price, retention period, suppression semantics, permission model, and evidence for security questionnaire answers.
* Operations must name the owners and backup owners for front-desk tasks at each clinic, including coverage after a clinic closes.
* The rollout dates assume the vendor contract, sender numbers, data mapping, and copy approval are complete before launch; the dates are not a vendor commitment.
* The source files contain inconsistent consent notes and shared numbers. Data operations must reconcile those records and define the duplicate-number review before production import.
* The outcome report should be agreed with finance and operations; this document assumes it will separate delivery failure, cancellation, and no-show outcomes without treating delivery as attendance.

```json
{
    "assumptions": [
        "The booking system remains the source of truth for appointment status.",
        "Compliance will approve English and Spanish copy before patient-facing sends.",
        "Vendor pricing, retention, reply permissions, and security evidence remain open until confirmed in writing.",
        "Operations will assign front-desk task owners and after-hours coverage before launch.",
        "Data operations will reconcile blank consent values and shared phone numbers before production import.",
        "The launch dates are planning assumptions rather than a vendor commitment."
    ],
    "requirements": [
        {
            "text": "The service must not send appointment texts from 20:00 through 08:00 in each clinic's local time, including weekends.",
            "id": "R1"
        },
        {
            "text": "For an eligible appointment, send exactly two reminders at 72 hours and 24 hours before the appointment; bookings inside 24 hours receive one immediate reminder.",
            "id": "R2"
        },
        {
            "text": "Each message may include the patient's first name and clinic name only; omit the provider name, treatment type, clinical findings, and diagnosis.",
            "id": "R3"
        },
        {
            "text": "Launch approved templates in English and Spanish; patients with any other language preference receive the English template until an approved translation exists.",
            "id": "R4"
        },
        {
            "text": "STOP, END, or UNSUBSCRIBE must immediately suppress future reminder texts for that phone number and record the preference in the patient record.",
            "id": "R5"
        },
        {
            "text": "A non-opt-out or ordinary reply creates a front-desk task for review within 60 minutes during open hours, or by the next opening after hours.",
            "id": "R6"
        },
        {
            "text": "Launch Cedar Grove Rehab and Harbor Point Therapy on March 3, 2025, then add Northgate Mobility on March 17, 2025 after a two-week operational check.",
            "id": "R7"
        },
        {
            "text": "Send only when explicit SMS consent is yes; blank or unknown consent, a missing mobile number, or a landline is ineligible and appears in an exception report.",
            "id": "R8"
        },
        {
            "text": "Re-check appointment status before each send; the service must not send reminders for appointments marked cancelled. A reschedule uses the new appointment record.",
            "id": "R9"
        },
        {
            "text": "Configure Cedar Grove Rehab, Harbor Point Therapy, and Northgate Mobility with their source-recorded local time zones and use that timezone for send decisions.",
            "id": "R10"
        },
        {
            "text": "Record clinic, appointment, language, send decision, provider status, opt-out, and reply events while separating delivery outcomes from cancellations.",
            "id": "R11"
        },
        {
            "text": "An authorized operations user can pause one clinic's outbound reminders, preserve the reason and actor, and resume without vendor support.",
            "id": "R12"
        }
    ]
}
```
