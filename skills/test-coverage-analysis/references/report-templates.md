# Test coverage analysis: report templates

Read this when creating the report file in Stage 1 and, for the current mode only, when assembling the final report.

# Common report structures

## Data Structures

**Test Coverage Map:**

```typescript
coverage_map: Map<
  featureName,
  {
    acceptance_criteria: [{ id; text; priority }];
    test_plans: [{ id; type; description; requirements }];
    discovered_tests: {
      unit: [{ file; testName; coverage; status }];
      integration: [{ file; testName; coverage; status }];
      e2e: [{ file; testName; coverage; status }];
    };
    coverage_stats: {
      total_criteria;
      covered_criteria;
      coverage_percentage;
      total_plans;
      covered_plans;
      plan_coverage_percentage;
      test_counts: { unit; integration; e2e };
      test_distribution: { unit_pct; integration_pct; e2e_pct };
    };
    gaps: [{ type; severity; description; recommendation }];
  }
>;
```

**Testing Philosophy:**

```typescript
{
  architecture_type: "frontend"|"backend"|"fullstack"|"serverless"|"microservices",
  recommended_model: "pyramid"|"trophy"|"hybrid",
  expected_distribution: { unit_pct, integration_pct, e2e_pct },
  rationale: string,
  focus_areas: string[]
}
```

**Validation State:**

```typescript
{
  mode: "coverage"|"readiness",
  analysis_depth: "summary"|"detailed",
  test_directories: string[],
  testing_philosophy: TestingPhilosophy,
  features_map, test_coverage_map,
  validation_results: {
    philosophy_analysis?, coverage_analysis?, gap_analysis?,
    pattern_analysis?, readiness_assessment?, risk_evaluation?,
    recommendations?
  }
}
```

## Standard Report Template

All reports follow this structure (customize sections per mode):

**CRITICAL: Progress Tracker**

Include at the top of the report file and update as stages complete:

```markdown
## Progress Tracker

- [x] Analysis started
- [ ] Testing philosophy detected
- [ ] Artifacts parsed
- [ ] Test distribution analyzed
- [ ] Functional test coverage calculated
- [ ] Non-functional test coverage analyzed
- [ ] Integration points analyzed
- [ ] Gaps identified (with subagent analysis)
- [ ] Pattern analysis complete
- [ ] Readiness assessment complete (Readiness mode only)
- [ ] Risk evaluation complete (Readiness mode only)
- [ ] Report finalized

**Last Updated:** [TIMESTAMP]
```

On the lightweight fallback, replace the Test distribution and Pattern analysis items with `- [x] Test distribution analyzed: skipped (lightweight fallback)` and `- [x] Pattern analysis complete: skipped (lightweight fallback)`.

**Report Structure:**

```
═══════════════════════════════════════════════════
TEST GAP ANALYSIS REPORT
═══════════════════════════════════════════════════

Analysis Date: [CURRENT_DATE] | Mode: [mode] | Features: [N]

## EXECUTIVE SUMMARY

**Overall Test Coverage:** [X]%
**Release Readiness:** [Ready/At Risk/Not Ready]

| Test Type     | Total | Covered | Missing | Coverage |
|---------------|-------|---------|---------|----------|
| Unit          | [N]   | [M]     | [P]     | [X]%     |
| Integration   | [N]   | [M]     | [P]     | [Y]%     |
| E2E           | [N]   | [M]     | [P]     | [Z]%     |

**Critical Gaps:** [N] | **Warnings:** [M] | **Manual Tests Required:** [P]

## [MODE-SPECIFIC SECTIONS]
[Content varies by analysis mode]

## RECOMMENDATIONS

### Critical Actions (Must Address Before Release)
[numbered list with specific test implementations needed]

### Warnings (Should Address)
[numbered list with recommended improvements]

### Manual Testing Requirements
[specific scenarios requiring manual validation]

## NEXT STEPS
[Mode-specific guidance]
```

# Final output message

**Final Output Message:**
```

✅ Test Gap Analysis Complete!

Report saved to: [output_file_path]
Analysis Duration: [X] seconds
Mode: [Coverage|Readiness]

Summary:

- Overall Coverage: [X]%
- Critical Gaps: [N]
- Warnings: [M]
- Manual Tests Required: [P]

Next Steps:
[Mode-specific guidance]

```

# Output formats

## Coverage Report Format

```markdown
# Test Coverage Analysis Report

**Generated:** [CURRENT_DATE]
**Mode:** Coverage Analysis
**Features Analyzed:** [N]

## Executive Summary

**Overall Test Coverage:** [X]%

### Coverage by Test Type
| Test Type     | Total | Covered | Missing | Coverage |
|---------------|-------|---------|---------|----------|
| Unit          | [N]   | [M]     | [P]     | [X]%     |
| Integration   | [N]   | [M]     | [P]     | [Y]%     |
| E2E           | [N]   | [M]     | [P]     | [Z]%     |

### Coverage by Feature
| Feature              | Criteria | Covered | Coverage | Status |
|----------------------|----------|---------|----------|--------|
| [Feature Name]       | [N]      | [M]     | [X]%     | [Icon] |

## Coverage Details

### Feature: [Feature Name]

**Acceptance Criteria Coverage:** [X]% ([M]/[N])

#### Covered Criteria
- ✅ AC-1.1: [Criterion text]
  - Tests: `test/unit/auth.test.ts::should authenticate user`
  - Tests: `test/integration/login.test.ts::should complete login flow`

#### Missing Coverage
- ❌ AC-1.2: [Criterion text]
  - **Impact:** Users cannot reset passwords
  - **Recommendation:** Implement unit test for password reset service
  - **Example Test:**
    ```typescript
    describe('Password Reset', () => {
      it('should send reset email when valid email provided', async () => {
        // Test implementation
      });
    });
    ```

#### Manual Testing Required
- AC-1.3: [Criterion text]
  - **Reason:** Requires email client verification
  - **Manual Test Procedure:**
    1. Navigate to forgot password page
    2. Enter valid email address
    3. Verify email received in inbox
    4. Click reset link and verify redirect
    5. Enter new password and verify login

## Gap Analysis

### Critical Gaps (Must Fix)
1. **Feature:** Authentication
   - **Gap:** No E2E test for user login flow
   - **Impact:** Cannot verify end-to-end login experience
   - **Recommendation:** Implement E2E test using Playwright
   - **Estimated Effort:** 2-3 hours

### Warning Gaps (⚠️ Should Fix)
1. **Feature:** User Profile
   - **Gap:** Partial coverage for profile update
   - **Impact:** Edge cases may not be handled correctly
   - **Recommendation:** Add tests for validation errors and concurrent updates

## Recommendations

### Immediate Actions
1. Implement E2E test for user login flow (Critical)
2. Add unit tests for password reset service (Critical)
3. Create integration test for profile update (Warning)

### Quality Improvements
1. Improve test naming conventions (use Given-When-Then)
2. Add more edge case coverage for validation logic
3. Implement test data fixtures for consistency

## Next Steps

1. **Address Critical Gaps:** Focus on authentication and core workflows
2. **Implement Manual Tests:** Document procedures for manual testing scenarios
3. **Re-run Analysis:** After implementing tests to verify coverage improvement
4. **Target Coverage:** Aim for 90% coverage before release

---

**Report Location:** `test-analysis-reports/coverage-[timestamp].md`
**Analysis Duration:** [X] seconds
```

## Readiness Report Format

```markdown
# Release Readiness Assessment

**Generated:** [CURRENT_DATE]
**Mode:** Readiness Assessment
**Release Target:** [DATE]

## Executive Summary

**Release Readiness:** [✅ Ready | ⚠️ At Risk | ❌ Not Ready]
**Overall Test Coverage:** [X]%
**Risk Level:** [High | Medium | Low]

## Quality Gates

| Gate                          | Status | Details                    |
| ----------------------------- | ------ | -------------------------- |
| Critical features 100% tested | [Icon] | [X]% coverage              |
| No failing tests              | [Icon] | [N] tests failing          |
| Test quality score ≥60        | [Icon] | Current score: [X]         |
| Security tests passing        | [Icon] | [N] security tests passing |
| Performance within SLA        | [Icon] | [Details]                  |

## Blocking Issues

### Critical (Must Fix Before Release)

1. **No E2E test for user login flow**
   - **Impact:** Cannot verify critical user journey
   - **Effort:** 2-3 hours
   - **Owner:** [Assign]

2. **Security test failing for SQL injection**
   - **Impact:** Potential security vulnerability
   - **Effort:** 1-2 hours
   - **Owner:** [Assign]

## Risk Assessment

### High Risks

1. **Untested authentication flow**
   - **Probability:** High (70%)
   - **Impact:** Critical (system unusable)
   - **Risk Score:** 70
   - **Mitigation:** Implement E2E test immediately

### Medium Risks

1. **Partial integration test coverage**
   - **Probability:** Medium (50%)
   - **Impact:** High (feature broken)
   - **Risk Score:** 50
   - **Mitigation:** Add integration tests for critical paths

## Release Checklist

- [x] All critical acceptance criteria covered (12/12)
- [x] All test plans implemented (8/8)
- [ ] No failing tests (1 failing)
- [x] Security tests passing (except SQL injection)
- [x] Performance tests within SLA
- [ ] Manual testing completed (payment gateway pending)
- [x] Test quality score ≥60 (current: 72)
- [ ] Critical gaps addressed (2 remaining)

**Checklist Status:** 6/8 items complete (75%)

## Recommendations

### Before Release (Required)

1. Fix failing SQL injection security test
2. Implement E2E test for user login flow
3. Complete manual testing for payment gateway

### Post-Release (Recommended)

1. Improve integration test coverage to 90%
2. Add performance tests for reporting feature
3. Implement automated accessibility tests

## Timeline

**Estimated Effort to Ready:** 6-8 hours
**Recommended Release Date:** [DATE] (if all blocking issues resolved)

---

**Report Location:** `test-analysis-reports/readiness-[timestamp].md`
**Next Assessment:** [DATE]
```
