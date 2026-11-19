# 2023 Expense Claims Analysis

**Analysed by:** Mark Taylor
**Date:** 5 March 2024
**Data Source:** claims-2023.csv

## Summary Statistics

- **Total claims:** 30
- **Total value:** £14,357.60
- **Average claim:** £478.59
- **Largest claim:** £2,500.00 (Event sponsorship)
- **Smallest claim:** £15.50 (Taxi)

## By Category

| Category | Count | Total Value | Average |
|----------|-------|-------------|---------|
| TRAVEL | 8 | £1,433.75 | £179.22 |
| SUBSISTENCE | 7 | £458.40 | £65.49 |
| EQUIPMENT | 3 | £1,170.00 | £390.00 |
| TRAINING | 3 | £2,245.00 | £748.33 |
| SUPPLIES | 4 | £240.80 | £60.20 |
| SOFTWARE | 2 | £1,080.00 | £540.00 |
| EVENT | 3 | £4,550.00 | £1,516.67 |

## By Grant Code

| Grant Code | Count | Total Value | Average |
|------------|-------|-------------|---------|
| GEN | 18 | £8,497.30 | £472.07 |
| YEP | 6 | £4,014.99 | £669.17 |
| CEP | 6 | £1,845.31 | £307.55 |

## Approval Analysis

### Approval Levels
- **Line manager only:** 18 claims (60%)
- **Head of Finance:** 8 claims (27%)
- **Executive Director:** 4 claims (13%)

### Approval Times
- **Fastest:** 5 days (claim 2023-001)
- **Slowest:** 42 days (claim 2023-014)
- **Average:** 14.3 days
- **Median:** 12 days

### Payment Times
- **Within 15 days:** 12 claims (40%)
- **16-30 days:** 14 claims (47%)
- **31+ days:** 4 claims (13%)

## Issues Identified

### 1. Large Claims without Secondary Approval
- Claim 2023-019 (£2,500) approved by James Wilson only
- Should have required secondary approver per audit recommendation

### 2. Grant Coding Issues
- Claim 2023-005 (£650 equipment) charged to CEP
- CEP restrictions: equipment purchases require pre-approval
- No evidence of pre-approval in records

### 3. Self-Approval
- Claim 2023-007 (£42.30): Sarah Chen approved own claim
- Claim 2023-010 (£480): Mark Taylor approved own claim
- No policy on self-approval limits

### 4. Missing Secondary Approver
- 4 claims over £500 had only one approver
- Policy requires Head of Finance for >£500

### 5. Timing Issues
- 3 claims submitted >30 days after expense
- No enforcement of submission deadline

## Recommendations for New System

1. **Automated approval routing** based on amount and grant
2. **Mandatory secondary approver** for claims over threshold
3. **Self-approval limits** with automatic escalation
4. **Grant validation** during submission
5. **Submission deadline enforcement**
6. **Real-time approval tracking**

## Key Requirements from Data

- System must handle 2-3 claims per week average
- Peak months: March, June, September
- Average claim value suggests £500 threshold appropriate
- Need escalation for claims outstanding >7 days