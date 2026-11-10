# ClinicQueue User Stories

## Epic 1: Patient self check-in

Our patients deserve a delightful, magical experience from the moment they arrive!

### 1.1 Scan QR to start
As a patient, I want to scan a QR code at the front desk so that I can start intake on my phone.
- AC: QR opens the clinic's intake form within 2 seconds on 4G

### 1.2 Fill demographics
As a patient, I want my demographics prefilled from my last visit so that I don't retype them.
- AC: Prefill pulls from FHIR Patient resource; PHI never cached on device after submit

### 1.3 Upload insurance card photo
As a patient, I want to photograph my insurance card so that staff don't scan it.
- AC: Image up to 10 MB, stored encrypted, linked to the check-in

### 1.4 Offline draft
As a patient, I want my partially filled form saved if I lose signal so that I don't start over.
- AC: Draft survives 10 minutes offline and syncs on reconnect

### 1.5 Consent signature
As a patient, I want to sign consent forms on screen so that paperwork is done before I see the provider.
- AC: Signed PDF written to EHR as a FHIR DocumentReference

### 1.6 Language choice
As a patient, I want to pick Spanish or English so that I understand the form.

### 1.7 Accessibility
As a patient using a screen reader, I want the form to be WCAG 2.1 AA so that I can complete it alone.

## Epic 2: Front desk triage

### 2.1 Live queue
As front-desk staff, I want a live queue of arrived patients so that I know who is ready.
- AC: New check-ins appear within 2 seconds; supports 40 staff screens per clinic

### 2.2 Flag incomplete forms
As front-desk staff, I want incomplete forms flagged so that I can help those patients first.

### 2.3 Push to EHR
As front-desk staff, I want to push a completed check-in to the EHR with one click so that I stop re-keying.
- AC: FHIR write succeeds or shows a retryable error; every write audited

### 2.4 Staff sign-in
As front-desk staff, I want to sign in with my clinic login so that I don't manage another password.
- AC: SAML 2.0 with the clinic IdP; session expires after 12 hours

### 2.5 PHI access audit
As a clinic compliance officer, I want a report of who viewed which patient record so that we pass HIPAA audits.
- AC: Query by patient or staff member over any range in the last 6 years

### 2.6 Dark mode
As front-desk staff, I want dark mode so that the screen is easier on my eyes.

### 2.7 Custom queue colors
As front-desk staff, I want to choose queue colors so that it matches our branding.
