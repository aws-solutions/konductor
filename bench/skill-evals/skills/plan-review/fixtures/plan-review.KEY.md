# plan-review fixture key
docs/plans/coupon-plan.md -> should be BLOCKED (1-2 stars):
- src/billing/discounts.js does not exist; applyCoupon does not exist in src/billing/invoice.js (file verification red flags).
- Vague tasks: "Implement the coupon feature", "Update the config" (which config?), "Handle edge cases appropriately", "Make sure it works". No verification commands, no purpose/background.
docs/plans/tax-region-plan.md -> clear, verified references (tax.js line 1 RATES, invoice.js line 7 computeTotal, line 6 rounding), concrete commands -> SHIP IT (5 stars) or at least OKAY 4.
docs/plans/cache-sidecar-plan.md -> direction (Redis sidecar) is fixed; a correct review must NOT argue against Redis. Gaps: tasks 2-4 lack verification, "Add monitoring" vague, task 3 "deploy time" has no file/tool reference, async Redis call vs synchronous taxFor callers (computeTotal) not addressed -> context gap. Expected OKAY 3 stars or BLOCKED 2; either acceptable if criteria scores justify it.
