# Risk Assessment - Expense Claims System

**Assessed by:** Sarah Chen
**Date:** 25 March 2024
**Review date:** 25 September 2024

## Risk Categories

### 1. Financial Risks
- **Fraudulent claims** - staff submitting false expenses
- **Duplicate payments** - same claim paid twice
- **Grant non-compliance** - expenses charged to wrong grants
- **Budget overspend** - no real-time budget checking

### 2. Operational Risks  
- **System downtime** - claims cannot be submitted/approved
- **Data loss** - receipts or claim data lost
- **Process failure** - approval chain breaks down
- **User error** - wrong information entered

### 3. Compliance Risks
- **Audit failure** - insufficient documentation
- **GDPR breach** - personal data mishandled
- **Charity Commission** - regulatory non-compliance
- **Grant funder** - breach of grant terms

### 4. Reputational Risks
- **Staff dissatisfaction** - poor user experience
- **Delayed payments** - staff not reimbursed timely
- **Public exposure** - system failure during audit

## Risk Mitigation for New System

### Must Have Controls
- **Segregation of duties** - submitter ≠ approver ≠ payer
- **Audit trail** - all actions logged with timestamp and user
- **Grant validation** - automatic checking against restrictions
- **Receipt retention** - secure storage for 7+ years
- **Approval workflows** - clear routing with escalation

### Should Have Controls
- **Budget checking** - warn if exceeding available funds
- **Duplicate detection** - flag similar claims
- **Policy reminders** - show relevant rules during submission
- **Manager dashboards** - visibility of team spending

### Could Have Controls
- **Receipt OCR** - automatic data extraction
- **Anomaly detection** - flag unusual patterns
- **Advanced analytics** - predictive spending trends

## Residual Risks

Even with new system:
- **Human error** - staff may still enter wrong information
- **System complexity** - users may find it difficult
- **Integration issues** - with Xero or other systems
- **Change resistance** - staff preferring old manual process

## Success Metrics for Risk Reduction

- Reduce fraudulent/duplicate claims to zero
- Eliminate grant coding errors
- Achieve 100% audit trail completeness
- Process 95% of claims within 5 days
- Maintain staff satisfaction > 4/5

## Implementation Risks

- **Scope creep** - adding too many features
- **Timeline slippage** - not ready for October go-live
- **Budget overrun** - exceeding £85,000
- **Training gaps** - staff not properly trained

## Mitigation Plan

1. **Phased implementation** - core features first, enhancements later
2. **Regular progress reviews** - weekly steering committee
3. **Contingency budget** - 10% for unexpected costs
4. **Comprehensive training** - all users before go-live
5. **Parallel running** - old and new systems for 1 month