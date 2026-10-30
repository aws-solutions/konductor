# Test coverage analysis: usage examples

Read this only if unsure what a mode's output should look like.

## Usage Examples

### Example 1: Frontend Application (Trophy Model)

**Request:** "Analyze test coverage for our React application"
**Actions:** Mode: coverage → Detect: Frontend (React) → Recommend: Trophy → Run tests: 1,236 test cases → Current: 20% unit, 73% integration, 7% E2E → Partially Aligned
**Output:**
```

TESTING PHILOSOPHY ANALYSIS
Architecture Detected: Frontend (React Application)
Recommended Model: Testing Trophy

Expected Test Distribution:

- Unit Tests: 20-30% (complex business logic only)
- Integration Tests: 50-60% (component integration, user flows)
- E2E Tests: 15-20% (critical user journeys)

Current Test Distribution (from test runner):

- Total Test Cases: 1,236
- Unit Tests: 20% (250 test cases)
- Integration Tests: 73% (900 test cases)
- E2E Tests: 7% (86 test cases)

Status: ⚠️ PARTIALLY ALIGNED

Analysis:
✅ Good: Unit test percentage aligns with Trophy model (20% vs 20-30%)
⚠️ Warning: Integration tests slightly high (73% vs 50-60%)
❌ Problem: E2E tests below target (7% vs 15-20%)

CRITICAL ACTIONS:

1. Add E2E tests for critical user journeys (need 100-160 more E2E test cases)
   - Current: 86 E2E tests
   - Target: 185-247 E2E tests (15-20% of 1,236)
   - Estimated effort: 20-30 hours

2. Consider converting some integration tests to E2E tests
   - Focus on complete user workflows
   - Rationale: Trophy model emphasizes E2E for critical paths

MANUAL TESTING REQUIRED:

1. Payment gateway integration - manual verification of transaction flow
2. Browser compatibility - test on Chrome, Firefox, Safari, Edge

Target Distribution: 20-30% unit, 50-60% integration, 15-20% E2E

```

### Example 2: Backend API (Pyramid Model)

**Request:** "Check test coverage for our Express API"
**Actions:** Mode: coverage → Detect: Backend (Express API) → Recommend: Pyramid → Run tests: 850 test cases → Current: 75% unit, 20% integration, 5% E2E → Aligned
**Output:**
```

TESTING PHILOSOPHY ANALYSIS
Architecture Detected: Backend (Express API)
Recommended Model: Testing Pyramid

Expected Test Distribution:

- Unit Tests: 70-80% (business logic, utilities)
- Integration Tests: 15-20% (service layer, database)
- E2E Tests: 5-10% (critical API workflows)

Current Test Distribution (from test runner):

- Total Test Cases: 850
- Unit Tests: 75% (638 test cases)
- Integration Tests: 20% (170 test cases)
- E2E Tests: 5% (42 test cases)

Status: ✅ WELL ALIGNED

Analysis:
✅ Good: Unit test coverage aligns with Pyramid model (75% vs 70-80%)
✅ Good: Integration test coverage on target (20% vs 15-20%)
✅ Good: E2E coverage appropriate (5% vs 5-10%)

RECOMMENDATIONS:

1. Maintain current test distribution - it's well aligned
2. Focus on improving test quality rather than adding more tests
3. Consider adding a few more E2E tests for edge cases (optional)

Overall: Excellent test distribution for backend API.
Target Distribution: 70-80% unit, 15-20% integration, 5-10% E2E

```

### Example 3: Readiness Assessment

**Request:** "Are we ready to release?"
**Actions:** Mode: readiness → Run tests: 1,236 test cases → Coverage 85% → Quality score 72 → 1 failing test → Risk: At Risk
**Output:**
```

EXECUTIVE SUMMARY
Overall Test Coverage: 85%
Release Readiness: ⚠️ AT RISK

Test Results:

- Total Test Cases: 1,236
- Passed: 1,235 (99.9%)
- Failed: 1 (0.1%)

BLOCKING ISSUES:

1. Critical: 1 failing test in EditBudgetSettings.test.tsx - must fix before release
   - Test: "initializes form with lease budget data"
   - Error: Unable to find element with placeholder "e.g., 50"
   - Impact: Budget settings form may not work correctly

RELEASE CHECKLIST:

- [x] All critical acceptance criteria covered (12/12)
- [x] All test plans implemented (8/8)
- [ ] No failing tests (1 failing)
- [x] Security tests passing
- [x] Performance tests within SLA
- [x] Manual testing completed
- [x] Test quality score ≥60 (current: 72)
- [x] Critical gaps addressed

RECOMMENDATION: Fix 1 failing test before release. Estimated effort: 1-2 hours.

````
