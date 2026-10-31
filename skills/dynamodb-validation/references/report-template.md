# Validation report template

Read this when assembling the validation report.

## Output Format Template

Generate validation reports in this structured format:

```markdown
# DynamoDB Design Validation Report

**Table Name**: [TableName]
**Validation Date**: [YYYY-MM-DD]
**Reviewer**: DynamoDB Design Checker
**Design Version**: [Version if provided, or "Initial Review"]

---

## Executive Summary

[2-3 sentence summary of overall design quality, most critical issues, and recommended next steps]

---

## Validation Summary

| Metric                     | Score     | Status                       | Change from Previous |
| -------------------------- | --------- | ---------------------------- | -------------------- |
| Partition Key Design       | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Index Coverage             | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Data Model Consistency     | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Cost Efficiency            | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Security Compliance        | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Backup & DR                | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Use Case Fit               | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Global Tables              | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Streams & Events           | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Transactions & Consistency | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Critical Pitfalls          | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Design Smells              | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Operational Readiness      | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| **Overall Design Quality** | **X/100** | **[ Pass / Warning / Fail]** | **[+/-X points]**    |

**Total Issues Found**: X Critical 🔴 | Y High 🟡 | Z Medium 🟢 | W Low ⚪

**Status Thresholds**:

- Pass: 90-100 (Excellent - production ready)
- Warning: 70-89 (Good - minor improvements recommended)
- Warning: 50-69 (Fair - significant improvements needed)
- Fail: 0-49 (Poor - major issues must be addressed)

---

## Critical Issues (Must Fix Before Implementation)

[If no critical issues: " No critical issues found."]

[Otherwise, list all critical findings using the Critical Finding Template]

### 🔴 CRITICAL: [Issue 1 Title]

[Full finding details using template]

### 🔴 CRITICAL: [Issue 2 Title]

[Full finding details using template]

---

## High Priority Issues (Should Fix)

[If no high priority issues: " No high priority issues found."]

[Otherwise, list all high findings using the High Finding Template]

### 🟡 HIGH: [Issue 1 Title]

[Full finding details using template]

### 🟡 HIGH: [Issue 2 Title]

[Full finding details using template]

---

## Medium Priority Issues (Consider Fixing)

[If no medium priority issues: " No medium priority issues found."]

[Otherwise, list all medium findings using the Medium Finding Template]

### 🟢 MEDIUM: [Issue 1 Title]

[Full finding details using template]

### 🟢 MEDIUM: [Issue 2 Title]

[Full finding details using template]

---

## Low Priority Issues (Optional Improvements)

[If no low priority issues: " No low priority issues found."]

[Otherwise, list all low findings using the Low Finding Template]

### ⚪ LOW: [Issue 1 Title]

[Full finding details using template]

### ⚪ LOW: [Issue 2 Title]

[Full finding details using template]

---

## Quality Metrics Breakdown

### Partition Key Design Score: X/100

**Components**:

- Cardinality: [X/40 points] - [Description: e.g., "1000+ unique values"]
- Distribution: [X/30 points] - [Description: e.g., "Even distribution across partitions"]
- Write Sharding: [X/15 points] - [Description: e.g., "Not needed for current traffic"]
- Appropriate Attribute: [X/15 points] - [Description: e.g., "userId is high-cardinality"]

**Assessment**:
[Detailed explanation of partition key quality, including specific strengths and weaknesses]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Index Coverage Score: X/100

**Components**:

- Access Pattern Coverage: [X/50 points] - [Description: e.g., "8/10 patterns covered"]
- No Table Scans: [X/30 points] - [Description: e.g., "2 patterns require Scan"]
- Sparse Indexes Used: [X/10 points] - [Description: e.g., "1 opportunity identified"]
- Projection Optimization: [X/10 points] - [Description: e.g., "GSI-1 over-projects 12 attributes"]

**Assessment**:
[Detailed explanation of index coverage quality]

**Uncovered Access Patterns**:

1. [Pattern 1]: [Why not covered] → [Recommended solution]
2. [Pattern 2]: [Why not covered] → [Recommended solution]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Data Model Consistency Score: X/100

**Components**:

- Naming Conventions: [X/30 points] - [Description]
- Attribute Types: [X/30 points] - [Description]
- Required Attributes: [X/20 points] - [Description]
- Relationship Patterns: [X/20 points] - [Description]

**Assessment**:
[Detailed explanation of data model consistency]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Cost Efficiency Score: X/100

**Components**:

- Billing Mode Alignment: [X/25 points] - [Description]
- Index Optimization: [X/25 points] - [Description]
- Single Table Benefits: [X/25 points] - [Description]
- Attribute Efficiency: [X/25 points] - [Description]

**Assessment**:
[Detailed explanation of cost efficiency]

**Current Monthly Cost Estimate**: $[X]
**Potential Monthly Savings**: $[Y] ([Z]% reduction)

**Cost Breakdown**:

- Table storage: $[X]
- Table throughput: $[Y]
- GSI storage: $[Z]
- GSI throughput: $[W]
- Backup costs: $[V]
- Data transfer: $[U]

**Optimization Opportunities**:

1. [Opportunity 1]: Save $[X]/month by [action]
2. [Opportunity 2]: Save $[Y]/month by [action]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Security Compliance Score: X/100

**Components**:

- Encryption Enabled: [X/40 points] - [Description]
- Access Control: [X/30 points] - [Description]
- Organizational Standards: [X/20 points] - [Description]
- Audit Logging: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of security compliance]

**Security Gaps**:

- [Gap 1]: [Description and risk]
- [Gap 2]: [Description and risk]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Backup & Disaster Recovery Score: X/100

**Components**:

- PITR Enabled: [X/40 points] - [Description]
- Backup Strategy: [X/30 points] - [Description]
- Cross-Region Backup: [X/20 points] - [Description]
- RTO/RPO Defined: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of backup and DR readiness]

**Current Configuration**:

- PITR: [Enabled/Disabled] - [Retention period if enabled]
- On-demand backups: [Schedule if configured]
- Cross-region: [Configured/Not configured]
- RTO target: [X hours/minutes]
- RPO target: [X hours/minutes]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Use Case Fit Score: X/100

**Assessment**:
[Evaluation of whether DynamoDB is appropriate for this use case]

**DynamoDB Strengths Leveraged**:

- [Strength 1]: [How design uses it]
- [Strength 2]: [How design uses it]

**Potential Concerns**:

- [Concern 1]: [Description and mitigation]
- [Concern 2]: [Description and mitigation]

**Alternative Considerations**:
[If applicable: "Consider [alternative service] for [specific requirements]"]

**Recommendations**:

- [Specific recommendation 1]

---

### Global Tables Score: X/100

[If global tables not used: " Global tables not configured. Score based on single-region design."]

**Components**:

- Conflict Resolution: [X/30 points] - [Description]
- Cost Analysis: [X/25 points] - [Description]
- Consistency Handling: [X/25 points] - [Description]
- Failover Procedures: [X/20 points] - [Description]

**Assessment**:
[Detailed explanation of global tables configuration]

**Recommendations**:

- [Specific recommendation 1]

---

### Streams & Events Score: X/100

[If streams not used: " Streams not configured. Score based on event-driven requirements."]

**Components**:

- Stream Configuration: [X/40 points] - [Description]
- View Type Appropriateness: [X/30 points] - [Description]
- Consumer Configuration: [X/20 points] - [Description]
- Error Handling: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of streams configuration]

**Recommendations**:

- [Specific recommendation 1]

---

### Transactions & Consistency Score: X/100

**Components**:

- Transaction Usage: [X/40 points] - [Description]
- Error Handling: [X/30 points] - [Description]
- Size Limits: [X/20 points] - [Description]
- Consistency Requirements: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of transaction usage]

**Recommendations**:

- [Specific recommendation 1]

---

### Critical Pitfalls Score: X/100

**Components**:

- Pitfall 1 (GSI Throttling): [Pass/Fail] - [Description]
- Pitfall 2 (Low Cardinality GSI): [Pass/Fail] - [Description]
- Pitfall 3 (GSI Backfilling): [Pass/Fail] - [Description]
- Pitfall 4 (LSI 10GB Limit): [Pass/Fail] - [Description]
- Pitfall 5 (Over-Indexing): [Pass/Fail] - [Description]
- Pitfall 6 (GSI Projections): [Pass/Fail] - [Description]
- Pitfall 7 (GSI Consistency): [Pass/Fail] - [Description]
- Pitfall 8 (GSI Monitoring): [Pass/Fail] - [Description]

**Assessment**:
[Detailed explanation of critical pitfalls found or avoided]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Design Smells Score: X/100

**Smells Detected**: [X] total

**By Category**:

- Partition Key Smells: [X] found
- Index Smells: [X] found
- Capacity Smells: [X] found
- Query Pattern Smells: [X] found

**Assessment**:
[Detailed explanation of design smells and their impact]

**Top 3 Smells to Address**:

1. [Smell 1]: [Impact and recommendation]
2. [Smell 2]: [Impact and recommendation]
3. [Smell 3]: [Impact and recommendation]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Operational Readiness Score: X/100

**Components**:

- Monitoring Configuration: [X/30 points] - [Description]
- Operational Procedures: [X/25 points] - [Description]
- Performance Baselines: [X/25 points] - [Description]
- Incident Response: [X/20 points] - [Description]

**Assessment**:
[Detailed explanation of operational readiness]

**Readiness Gaps**:

- [Gap 1]: [Description and risk]
- [Gap 2]: [Description and risk]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

## Production Readiness Assessment

### Gate 1: Design Review

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] All access patterns documented with frequency
- [ ] Partition key cardinality validated (> 1000 unique values)
- [ ] Index strategy justified and validated
- [ ] Capacity calculations reviewed and approved
- [ ] Cost analysis completed and approved
- [ ] Security requirements met
- [ ] Peer review completed

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Gate 2: Implementation Review

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] Infrastructure code reviewed (CDK/CloudFormation)
- [ ] All security settings enabled (encryption, IAM)
- [ ] Monitoring and alarms configured
- [ ] Backup strategy implemented (PITR, on-demand)
- [ ] Example queries tested and validated
- [ ] Error handling validated (retry logic, exponential backoff)
- [ ] Documentation complete (runbook, troubleshooting)

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Gate 3: Load Testing

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] Partition distribution validated (no hot partitions)
- [ ] Query latency meets requirements (p99 < 50ms)
- [ ] No throttling at 2× expected peak load
- [ ] GSI backfill tested (if applicable)
- [ ] Failure scenarios tested (throttling, timeouts)
- [ ] Monitoring validated (metrics, alarms working)
- [ ] Runbook validated with test scenarios

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Gate 4: Production Validation

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] CloudWatch metrics reviewed (no throttling)
- [ ] Partition distribution monitored (no hot partitions)
- [ ] Query latency within SLA (p99, p95, p50)
- [ ] Error rates acceptable (< 0.1%)
- [ ] Cost tracking enabled and reviewed
- [ ] No unexpected capacity consumption
- [ ] Team trained on monitoring and troubleshooting

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Overall Production Readiness

**Status**: [ READY FOR PRODUCTION / READY WITH CAVEATS / NOT READY]

**Summary**: [Brief explanation of overall readiness status]

**Gates Passed**: [X]/4

**Critical Blockers**: [List critical blockers preventing production deployment]

**Recommended Timeline**:

- Gate 1 completion: [Estimate or "Complete"]
- Gate 2 completion: [Estimate or "Complete"]
- Gate 3 completion: [Estimate or "Complete"]
- Gate 4 completion: [Estimate or "Complete"]
- **Production Ready**: [Date estimate or "Ready now"]

---

## Iteration Progress

[If this is first review: " This is the initial baseline validation. Save this report for future comparison."]

[If this is a re-validation:]

### Comparison to Previous Review

**Previous Validation Date**: [YYYY-MM-DD]
**Current Validation Date**: [YYYY-MM-DD]

**Score Changes**:

- **Previous Overall Score**: [X]/100
- **Current Overall Score**: [Y]/100
- **Improvement**: [+/-Z] points ([+/-W]%)

**Status Change**: [Previous Status] → [Current Status]

---

### Issues Resolved Since Last Review

[If no issues resolved: " No issues from previous review have been resolved."]

[Otherwise:]

**Resolved Issues** ([X] total):

1. **[Issue Title]** (was [Priority])
   - Resolution: [How it was fixed]
   - Impact: [Benefit gained]

2. **[Issue Title]** (was [Priority])
   - Resolution: [How it was fixed]
   - Impact: [Benefit gained]

---

### Issues Remaining from Previous Review

[If no remaining issues: " All issues from previous review have been resolved!"]

[Otherwise:]

**Unresolved Issues** ([X] total):

1. **[Issue Title]** ([Priority])
   - Status: [Unchanged / Partially improved]
   - Reason: [Why still present]

2. **[Issue Title]** ([Priority])
   - Status: [Unchanged / Partially improved]
   - Reason: [Why still present]

---

### New Issues Identified

[If no new issues: " No new issues introduced since last review."]

[Otherwise:]

**New Issues** ([X] total):

1. **[Issue Title]** ([Priority])
   - Cause: [Why this is new - e.g., "New access pattern added"]

2. **[Issue Title]** ([Priority])
   - Cause: [Why this is new]

---

### Iteration Summary

**Progress Assessment**: [Excellent / Good / Minimal / Regressed]

**Key Improvements**:

- [Improvement 1]
- [Improvement 2]

**Persistent Challenges**:

- [Challenge 1]
- [Challenge 2]

**Recommended Focus for Next Iteration**:

1. [Priority 1 recommendation]
2. [Priority 2 recommendation]
3. [Priority 3 recommendation]

---

## Recommendations Summary

### Immediate Actions (Critical/High Priority)

**Must address before production deployment**:

1. **[Action 1]** (Critical)
   - Issue: [Brief description]
   - Impact: [Key impact]
   - Effort: [Low/Medium/High]

2. **[Action 2]** (High)
   - Issue: [Brief description]
   - Impact: [Key impact]
   - Effort: [Low/Medium/High]

**Total Estimated Effort**: [X] hours

---

### Future Improvements (Medium/Low Priority)

**Consider for next iteration**:

1. **[Action 1]** (Medium)
   - Benefit: [Key benefit]
   - Effort: [Low/Medium/High]

2. **[Action 2]** (Low)
   - Benefit: [Key benefit]
   - Effort: [Low/Medium/High]

**Total Estimated Effort**: [X] hours
**Total Potential Savings**: $[Y]/month

---

## Next Steps

1. **Review Findings**: Discuss critical and high priority issues with team
2. **Prioritize Fixes**: Determine which issues to address in next iteration
3. **Implement Changes**: Apply recommended fixes to design
4. **Re-validate**: Submit updated design for validation
5. **Track Progress**: Compare scores to measure improvement

---

## Additional Resources

**AWS Documentation**:

- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Partition Key Design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)
- [Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [DynamoDB Pricing](https://aws.amazon.com/dynamodb/pricing/)

**Organizational Resources**:
[If organizational standards provided, list relevant links]

---

**Report Generated**: [Timestamp]
**Validation Tool**: DynamoDB Design Checker
```

---
