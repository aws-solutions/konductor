# BrightHope Charity - Expense Claims System Requirements

**Document Status:** Approved for vendor RFI
**Version:** 1.0
**Date:** 15 April 2024
**Author:** Requirements Working Group
**Audience:** System vendors, implementation team

## 1. Introduction

BrightHope Charity requires a new digital expense claims system to replace the current manual email-based process. The system must handle approximately 120-150 claims per year from 45 staff, with an average claim value of £480. The primary goals are to reduce processing time from 14 to under 5 days, eliminate grant coding errors, provide real-time visibility, and ensure compliance with charity regulations.

## 2. Business Objectives

- Reduce manual data entry by 90%
- Process 95% of claims within 5 working days
- Achieve zero grant coding compliance errors
- Provide staff satisfaction score > 4/5
- Ensure full audit trail for all transactions
- Integrate seamlessly with Xero accounting software

## 3. Functional Requirements

### 3.1 Claim Submission
**R1:** Staff must be able to submit expense claims electronically via web and mobile interfaces.
**R2:** The system must allow receipt upload as photos or scans for all claims, with clear visibility of date, amount, vendor, and items.
**R3:** A mileage calculator must automatically compute amounts based on distance and the current rate of 45p per mile for cars.
**R4:** Grant code selection must include validation against active grants and display relevant restrictions during submission.
**R5:** The system must enforce a 30-day submission deadline from expense date.

### 3.2 Approval Workflow
**R6:** Claims under £500 require only line manager approval.
**R7:** Claims between £500 and £2,000 require Head of Finance approval in addition to line manager.
**R8:** Claims over £2,000 require Executive Director approval in addition to line manager and Head of Finance.
**R9:** Claims over £1,000 require a second approver from Finance, with the Head of Finance serving as second approver when needed.
**R10:** Managers may approve their own expenses up to £100 without additional approval; above £100, approval must come from their line manager or Head of Finance.
**R11:** The system must support delegation setup in advance for when approvers are away, routing to deputies or department heads as configured.
**R12:** Automatic escalation must occur after 2 working days without action on a claim.

### 3.3 Grant Compliance
**R13:** The system must validate grant codes against the active grants list and prevent submission to inactive or invalid grants.
**R14:** Grant restriction checking must enforce daily rate caps, including the £60 daily subsistence limit per person for the Youth Empowerment Programme (YEP) grant (renewed terms from April).
**R15:** The system must enforce the Community Engagement Programme (CEP) accommodation limit of £95 per night and food limit of £35 daily (renewed terms from April).
**R16:** Pre-approval requirements for specific grant expenditures (e.g., equipment over £300 for YEP) must be checked before submission.
**R17:** Expenses incompatible with grant purposes (e.g., fundraising costs on CEP) must be blocked or flagged for manual override.

### 3.4 Receipt Management
**R18:** Digital receipts (photos, scans) must be acceptable for all claims, provided they are legible and show required details.
**R19:** The system must store all receipts and claim documentation for minimum 7 years for audit purposes.
**R20:** Receipt metadata (date, amount, vendor) should be extractable via OCR where possible.

### 3.5 Payment Processing
**R21:** The system must support twice-monthly payment runs: on the 10th for claims approved by the 25th of previous month, and on the 25th for claims approved by the 10th of current month.
**R22:** Approved claims must export automatically to Xero with correct coding and without manual data entry.
**R23:** Payment status must be visible to claimants and finance team in real-time.

### 3.6 Reporting and Analytics
**R24:** Real-time dashboard must show claim status, ageing, approval times, and grant spending.
**R25:** Audit reports must provide complete trail of all actions: submission, approval, payment, and any modifications.
**R26:** Budget vs actual reporting must be available for each grant and department.

## 4. Non-Functional Requirements

**NR1:** System must be cloud-based with UK data hosting for GDPR compliance.
**NR2:** Availability must exceed 99.5% during business hours (8am-6pm, Monday-Friday).
**NR3:** Mobile interface must be fully functional on iOS and Android devices.
**NR4:** API access must be provided for integration with Xero and future systems.
**NR5:** Role-based access control must ensure segregation of duties (submitter ≠ approver ≠ payer).

## 5. Assumptions

1. Staff will have internet access for submission, including field staff via mobile data.
2. Xero integration will use standard APIs without custom development.
3. Existing grant restriction rules are documented and will not change during implementation.
4. All staff will receive training on the new system and processes.
5. Historical data migration from old system is not required.
6. The system will operate in GBP only; multi-currency not required.

## 6. Constraints

- Budget: £85,000 capital expenditure approved
- Timeline: Go-live by October 2024
- Integration: Must work with existing Xero instance
- Compliance: Must meet Charity Commission and audit requirements
- Legacy: Must accommodate staff with varying technical ability

## 7. Success Criteria

- 80% reduction in manual data entry
- 95% of claims processed within 5 working days
- Zero grant coding errors in first 6 months
- Staff satisfaction score > 4/5 in post-implementation survey
- Full audit trail for 100% of claims
- Finance team time on expenses reduced from 15 to 3 hours/week

```json
{
  "requirements": [
    {"id": "R1", "text": "Staff must be able to submit expense claims electronically via web and mobile interfaces."},
    {"id": "R2", "text": "The system must allow receipt upload as photos or scans for all claims, with clear visibility of date, amount, vendor, and items."},
    {"id": "R3", "text": "A mileage calculator must automatically compute amounts based on distance and the current rate of 45p per mile for cars."},
    {"id": "R4", "text": "Grant code selection must include validation against active grants and display relevant restrictions during submission."},
    {"id": "R5", "text": "The system must enforce a 30-day submission deadline from expense date."},
    {"id": "R6", "text": "Claims under £500 require only line manager approval."},
    {"id": "R7", "text": "Claims between £500 and £2,000 require Head of Finance approval in addition to line manager."},
    {"id": "R8", "text": "Claims over £2,000 require Executive Director approval in addition to line manager and Head of Finance."},
    {"id": "R9", "text": "Claims over £1,000 require a second approver from Finance, with the Head of Finance serving as second approver when needed."},
    {"id": "R10", "text": "Managers may self-approve expenses up to £100 without needing another approver."},
    {"id": "R11", "text": "The system must support delegation setup in advance for when approvers are away, routing to deputies or department heads as configured."},
    {"id": "R12", "text": "Automatic escalation must occur after 2 working days without action on a claim."},
    {"id": "R13", "text": "The system must validate grant codes against the active grants list and prevent submission to inactive or invalid grants."},
    {"id": "R14", "text": "Grant restriction checking must enforce daily rate caps, including the £60 daily subsistence limit per person for the Youth Empowerment Programme (YEP) grant (renewed terms from April)."},
    {"id": "R15", "text": "The system must enforce the Community Engagement Programme (CEP) accommodation limit of £95 per night and food limit of £35 daily (renewed terms from April)."},
    {"id": "R16", "text": "Pre-approval requirements for specific grant expenditures must be checked before submission."},
    {"id": "R17", "text": "Expenses incompatible with grant purposes must be blocked or flagged for manual override."},
    {"id": "R18", "text": "Digital receipts must be acceptable for all claims, provided they are legible and show required details."},
    {"id": "R19", "text": "The system must retain all receipts and claim documentation for 7 years for audit purposes."},
    {"id": "R20", "text": "Receipt metadata should be extractable via OCR where possible."},
    {"id": "R21", "text": "The system must support twice-monthly payment runs: on the 10th for claims approved by the 25th of previous month, and on the 25th for claims approved by the 10th of current month."},
    {"id": "R22", "text": "Approved claims must export automatically to Xero with correct coding and without manual data entry."},
    {"id": "R23", "text": "Payment status must be visible to claimants and finance team in real-time."},
    {"id": "R24", "text": "Real-time dashboard must show claim status, ageing, approval times, and grant spending."},
    {"id": "R25", "text": "Audit reports must provide complete trail of all actions: submission, approval, payment, and any modifications."},
    {"id": "R26", "text": "Budget vs actual reporting must be available for each grant and department."}
  ],
  "assumptions": [
    "Staff will have internet access for submission, including field staff via mobile data.",
    "Xero integration will use standard APIs without custom development.",
    "Existing grant restriction rules are documented and will not change during implementation.",
    "All staff will receive training on the new system and processes.",
    "Historical data migration from old system is not required.",
    "The system will operate in GBP only; multi-currency not required."
  ]
}
```