# Patient Intake Service

Clinics use this service to submit new-patient intake forms before a first visit.

## Compliance

The service stores and processes protected health information (PHI). It must meet HIPAA before launch. AWS has a signed BAA covering the account. All clinic staff sign in through the clinic IdP with MFA.

## Components

- **IntakeFunction** (Lambda): receives a submitted form, writes the structured record to the `intake-records` DynamoDB table, and stores the scanned paper form in the `acme-intake-scans` bucket. It reads a record back by `patientId` to show the confirmation page. It never lists or scans the table.
- **intake-records** (DynamoDB): one item per intake form. Contains name, date of birth, insurance ID and medical history. PHI.
- **acme-intake-scans** (S3): scanned PDF of the signed paper form. PHI.
- **acme-clinic-assets** (S3): logos and images for the public clinic website. No PHI, no customer data.
- **PhiKey** (KMS customer managed key): created for PHI encryption.
- **AuditTrail** (CloudTrail) writing to `acme-intake-audit-logs`.

## Data classification

| Store              | Data                 | Class     |
| ------------------ | -------------------- | --------- |
| intake-records     | Intake forms         | PHI       |
| acme-intake-scans  | Scanned forms        | PHI       |
| acme-clinic-assets | Public website files | Public    |
| intake-audit-logs  | CloudTrail logs      | Internal  |
