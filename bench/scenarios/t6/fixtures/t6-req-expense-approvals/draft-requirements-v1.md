# Draft Requirements - Expense System v1

**Created:** 5 April 2024
**Author:** James Wilson
**Status:** Early draft - for discussion

## User Stories

### As a staff member, I want to:
- Submit expense claims electronically
- Upload receipt photos from my phone
- See my claim status in real-time
- Get paid within 10 working days
- Receive notifications when claim moves
- Have mileage calculated automatically

### As a line manager, I want to:
- Approve/reject claims with one click
- See all pending claims in one place
- Delegate approval when I'm away
- Add comments to claims
- Get reminders for overdue approvals
- View team expense trends

### As a finance officer, I want to:
- Automatically import claims to Xero
- Validate grant coding automatically
- Run payment batches easily
- Generate audit reports
- Enforce policy rules
- Reduce manual data entry

### As the Head of Finance, I want to:
- Monitor compliance with policies
- Track grant spending against budgets
- Identify process bottlenecks
- Ensure segregation of duties
- Meet audit requirements
- Reduce processing costs

## Functional Requirements

### 1. Claim Submission
- Web and mobile interfaces
- Receipt upload (image/PDF)
- Automatic data extraction from receipts
- Mileage calculator with map integration
- Grant code selection with guidance
- Policy reminders during submission
- Save as draft capability

### 2. Approval Workflow
- Configurable approval chains
- Amount-based routing (£500, £2,000 thresholds)
- Grant-specific approval rules
- Escalation after 2 working days
- Delegation for absences
- Secondary approver for large amounts
- Bulk approval for small claims

### 3. Grant Compliance
- Grant code validation (exists, active)
- Restriction checking (travel, amounts, categories)
- Daily rate limits enforcement
- Pre-approval requirement checking
- Warning/blocking of non-compliant claims
- Integration with grant database

### 4. Finance Processing
- Automatic export to Xero
- Payment batch creation
- Bank transfer file generation
- Receipt storage (7+ years)
- Audit trail of all actions
- Reconciliation reporting

### 5. Reporting
- Real-time dashboard
- Ageing analysis
- Grant spending reports
- Approval time metrics
- Policy compliance tracking
- Budget vs actual

## Open Questions

1. Should we allow self-approval for small amounts?
2. What threshold for secondary approver?
3. How to handle international per diems?
4. What receipt standards for photos?
5. Integration with travel booking system?
6. Corporate cards in this phase?

## Next Steps

1. Review with stakeholders
2. Prioritise requirements
3. Map to vendor capabilities
4. Create detailed specification