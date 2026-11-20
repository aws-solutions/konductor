# Active project limits

## Product decision

The limit is a hard admission limit for new projects. Existing records are never removed or renamed when the limit is introduced. A limit response is also available to the product UI so it can show a warning before a create fails. The warning is informational; the create error is the enforcement boundary.

## Atomic create path

The read of usage and the insert must be one account-scoped critical section. The project repository's `withAccountLock` delegates to the store's `withLock`; the single-create and batch paths both call the same limit service. A caller-only check would allow two simultaneous requests to observe the same remaining slot. This lock is process-local; a horizontally scaled deployment needs a shared coordination mechanism or must keep project writes on one process. Duplicate-name validation is inside that section too, so the two checks see the same serialized state.

## Bulk and support operations

The partner batch endpoint processes rows in input order and returns HTTP 145 with one result per submitted row. A transport retry may see a prior successful name as `project_name_taken`, so the partner reconciler must treat row outcomes as durable evidence rather than replaying a successful row blindly. A successful row contains its project; a rejected row contains its error code. The service continues after a row reaches the limit, so earlier successes are retained and later rows receive `project_limit_reached`.

## Rollout and compatibility

The flags `project_limits_shadow_enabled` and `project_limits_enabled` use the existing naming rule. Shadow mode records usage and near-limit observations without rejecting creates. Enforcement starts only after the shadow observations are understood. Compare the warning population and projected rejects with real create errors so a noisy warning does not become a surprise support burden. The rollout document names the gates, ring order, and rollback steps.

```json
{
 "decisions": [
  {
   "topic": "admission",
   "choice": "Use hard enforcement for new project creates at a finite active-project limit, while near-limit warnings remain advisory.",
   "reason": "A caller can see capacity before a create, but the service must reject a create that would exceed the plan."
  },
  {
   "topic": "active projects",
   "choice": "Count only records whose stored status is exactly active; archived and deleted records do not consume capacity.",
   "reason": "Those statuses represent history rather than current work, so counting them would make capacity unpredictable."
  },
  {
   "topic": "concurrency",
   "choice": "Put the usage check and insert inside the repository withAccountLock backed by the store withLock.",
   "reason": "Serializing the decision with the write prevents two concurrent requests from consuming the same final slot."
  },
  {
   "topic": "existing data",
   "choice": "Keep accounts already above a finite limit and block further creates until their active count falls below the limit.",
   "reason": "Introducing a ceiling must preserve existing customer work and apply only to future admission."
  }
 ],
 "risks": [
  {
   "risk": "The process-local account lock does not coordinate separate service processes.",
   "mitigation": "Use a shared coordination mechanism or keep project writes on one process before horizontal scaling."
  }
 ],
 "evidence": [
  "config/plans.json:3",
  "src/store/json-store.js:18"
 ]
}
```
