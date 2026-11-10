# ClinicQueue: Requirements (Final)

## Press Release

**SEATTLE** — Today we are thrilled to announce ClinicQueue, the revolutionary,
world-class patient intake platform that will transform healthcare forever!

> "ClinicQueue changed everything about how our front desk works. I can't imagine
> going back." — Dana Whitfield, Office Manager, Riverbend Family Practice

## Problem

Front-desk staff at small and mid-size outpatient clinics (5-40 providers) spend
an average of 11 minutes per patient on paper intake forms and re-keying data into
the EHR. Clinics lose an estimated 14% of same-day appointment capacity to
intake delays.

## Users

- Primary buyer: clinic operations manager
- End users: front-desk staff (create and triage check-ins) and patients
  (fill forms on their own phone)

## Goals and success metrics

- Cut intake time from 11 minutes to under 3 minutes per patient
- Recover at least 10% of same-day appointment capacity within 6 months
- 90% of patients complete intake on their phone without staff help

## Scale

- Pilot (demo) scale: 3 clinics, 200 concurrent patients, 2,000 check-ins per day
- Production target in 12 months: 400 clinics, 5,000 concurrent patients,
  250,000 check-ins per day

## Non-functional

- Check-in submission p95 latency under 500 ms
- 99.9% monthly availability during clinic hours (06:00-22:00 local)
- Form drafts must survive a phone losing connectivity for up to 10 minutes

## Security and compliance

- HIPAA: all PHI encrypted at rest (KMS customer managed keys) and in transit (TLS 1.2+)
- Patient data for EU clinics must stay in eu-central-1
- Audit log of every PHI read, retained 6 years
- Staff sign in with the clinic's existing SAML IdP; patients use a one-time SMS link

## Constraints

- Deploys into each customer's own AWS account via CDK
- Backend in TypeScript on Lambda; the customer ops team must not manage servers
- Integrate with the clinic EHR through HL7 FHIR R4 APIs
- Phase 1 excludes insurance eligibility checks and payments

## Timeline

- Pilot launch: 2027-03-01
