# Technical Notes for System Requirements

**Author:** Mark Taylor
**Date:** 1 April 2024

## Current System Landscape

### Accounting Software
- **Xero** (cloud-based)
- Chart of accounts: 200+ codes
- Bank feeds: 3 accounts
- User licenses: 5 finance staff

### HR System  
- **Breathe HR** (cloud)
- Staff database: 45 records
- Organisational hierarchy
- Leave management

### Grant Management
- **Excel spreadsheets** (manual)
- Grant register: 15 active grants
- Restriction rules: documented but not enforced
- Reporting: manual quarterly

### Current Expense Process
- PDF forms emailed
- Manual data entry to Xero
- Paper filing for receipts
- No tracking or audit trail

## Integration Requirements

### Xero Integration
- Push approved claims as bills
- Map grant codes to Xero account codes
- Include VAT treatment (most expenses are VAT-exempt)
- Handle payment reconciliation

### Data Structure
- Staff: 45 records (name, dept, manager, email)
- Grants: 15 records (code, name, restrictions, budget)
- Approval rules: hierarchical based on amount
- Rate tables: mileage, per diem, accommodation

### Security Requirements
- Role-based access: submitter, approver, finance, admin
- Two-factor authentication for approvers
- Audit log of all changes
- GDPR compliance for receipt storage

## Performance Requirements
- Support 50 concurrent users
- Handle 200+ claims per month peak
- Sub-second response for most operations
- 99.5% availability during business hours

## Mobile Requirements
- iOS 14+ and Android 10+ support
- Offline receipt capture
- Photo quality validation
- Push notifications

## Reporting Requirements
- Real-time dashboards
- Export to Excel/PDF
- Scheduled reports
- API for data extraction

## Testing Considerations
- UAT with 5-10 staff members
- Parallel running with old process for 1 month
- Load testing for month-end
- Disaster recovery testing