# Active project limits

## Rollout and compatibility

The flags `project_limits_shadow_enabled` and `project_limits_enabled` use the existing naming rule. Shadow mode records usage and near-limit observations without rejecting creates. Enforcement starts only after the shadow observations are understood. Compare the warning population and projected rejects with real create errors so a noisy warning does not become a surprise support burden. The rollout document names the gates, ring order, and rollback steps.

Evidence below points to the repository facts used for these choices. Each reference is a repository-relative `path:line`.

```json
{
 "evidence": [
  "docs/partners.md:5",
  "docs/partners.md:3",
  "src/store/json-store.js:18",
  "config/plans.json:3"
 ],
 "risks": [
  {
   "mitigation": "In short: Compare shadow projections with real create errors and treat durable per-row outcomes as reconciliation evidence.",
   "risk": "Warning noise and partner retries can obscure rollout signals or repeat a successful row."
  },
  {
   "mitigation": "In short: Use a shared coordination mechanism or keep project writes on one process before horizontal scaling.",
   "risk": "The process-local account lock does not coordinate separate service processes."
  }
 ],
 "decisions": [
  {
   "reason": "In short: The warning population and projected rejects must be understood before a hard admission boundary reaches all accounts.",
   "choice": "Run shadow observations before enabling enforcement, then compare projections with actual rejected creates.",
   "topic": "observation before enforcement"
  },
  {
   "reason": "In short: Support needs bounded extra capacity without changing the plan catalogue or granting an unbounded exception.",
   "choice": "Allow an account-scoped positive project-limit override with an optional ISO 8601 expiry evaluated against absolute UTC time.",
   "topic": "support changes"
  },
  {
   "reason": "In short: Partners can reconcile successful and rejected rows without losing earlier work in the same request.",
   "choice": "Return HTTP 207 with ordered per-row partial results and continue processing after a row reaches the limit.",
   "topic": "bulk imports"
  },
  {
   "reason": "In short: Introducing a ceiling must preserve existing customer work and apply only to future admission.",
   "choice": "Keep accounts already above a finite limit and block further creates until their active count falls below the limit.",
   "topic": "existing data"
  },
  {
   "reason": "In short: Serializing the decision with the write prevents two concurrent requests from consuming the same final slot.",
   "choice": "Put the usage check and insert inside the repository withAccountLock backed by the store withLock.",
   "topic": "concurrency"
  },
  {
   "reason": "In short: Those statuses represent history rather than current work, so counting them would make capacity unpredictable.",
   "choice": "Count only records whose stored status is exactly active; archived and deleted records do not consume capacity.",
   "topic": "active projects"
  },
  {
   "reason": "In short: A caller can see capacity before a create, but the service must reject a create that would exceed the plan.",
   "choice": "Use hard enforcement for new project creates at a finite active-project limit, while near-limit warnings remain advisory.",
   "topic": "admission"
  }
 ]
}
```

## Bulk and support operations

The partner batch endpoint processes rows in input order and returns HTTP 207 with one result per submitted row. A transport retry may see a prior successful name as `project_name_taken`, so the partner reconciler must treat row outcomes as durable evidence rather than replaying a successful row blindly. A successful row contains its project; a rejected row contains its error code. The service continues after a row reaches the limit, so earlier successes are retained and later rows receive `project_limit_reached`.

Support can set an account-level `projectLimitOverride` with a positive integer `limit` and optional ISO 8601 `expiresAt`. The route is support-only at the service boundary, and the change should be recorded through the existing audit path with the operator and account. The override is checked before the plan, applies only to that account, and expires by comparing absolute timestamps. An expired override falls back to the plan catalogue. The route returns the resulting usage view, which makes the effective source visible to support tooling.

## Atomic create path

The read of usage and the insert must be one account-scoped critical section. The project repository's `withAccountLock` delegates to the store's `withLock`; the single-create and batch paths both call the same limit service. A caller-only check would allow two simultaneous requests to observe the same remaining slot. This lock is process-local; a horizontally scaled deployment needs a shared coordination mechanism or must keep project writes on one process. Duplicate-name validation is inside that section too, so the two checks see the same serialized state.

The catalogue values are counts of active projects: Free 3, Team 10, Business 25, and Legacy unlimited. Near-limit is true at 80% or more of a finite limit. Usage returns `activeProjects`, `limit`, `remaining`, `nearLimit`, `warning`, `source`, and an optional UTC `expiresAt`.

## Product decision

The limit is a hard admission limit for new projects. Existing records are never removed or renamed when the limit is introduced. A limit response is also available to the product UI so it can show a warning before a create fails. The warning is informational; the create error is the enforcement boundary.

The count is the number of projects whose stored `status` is exactly `active`. Archived and deleted records remain useful history but do not consume capacity. A `legacy` account has a null plan limit and therefore remains unlimited. An account already above a newly finite limit keeps all of its projects and cannot create another until its active count falls below the limit.
