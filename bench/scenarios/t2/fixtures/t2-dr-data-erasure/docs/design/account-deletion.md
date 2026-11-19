# Account deletion request design

**Status:** Proposed for production rollout  
**Owner:** Identity and Core Services  
**Reviewers:** Privacy Operations, Data Platform, Search, Messaging, Infrastructure  
**Last updated:** 18 April 2025

## 1. Purpose and scope

This design describes how the consumer app handles a verified request to delete an account. It covers request intake, authorization, removal from live application systems, downstream propagation, audit evidence, and operational rollout. The design preserves records that a documented legal or financial exception requires while removing ordinary profile data.

The proposal is deliberately asynchronous. The API can acknowledge a request quickly, and the worker can coordinate systems without holding an HTTP request open. Account deletion is irreversible after the worker enters its execution state. A user may cancel while a request is waiting for work, but cancellation is rejected after execution begins.

The design applies to consumer accounts and their uploaded content. Support cases, ledger entries, and abuse signals remain under their own retention rules. A request reference, rather than a copy of the user's submitted message, is the unit shared between services.

### 1.1 Goals and non-goals

The goals are to stop ordinary processing for the account, remove data from the systems used by the product, provide a durable record of the decision, and keep the work within the service target. The design also avoids a large new data store by reusing the existing account event stream and queue.

The design does not change the retention policy of the warehouse, the notification provider, or the backup service. Those systems continue to follow their existing platform policies. It does not attempt to erase aggregate metrics that contain no account identifier.

### 1.2 Terms and request states

A request has one of `received`, `verified`, `queued`, `executing`, `completed`, `held`, or `failed`. `received` means the API has accepted a case but has not yet established account ownership. `verified` means the account owner passed the current verification flow. `held` is used for a legal hold or a review by Privacy Operations.

The Account service owns the state transition. Every transition includes a monotonic sequence number and a request reference. A request is immutable after verification except for its hold status and execution outcome. The worker uses the request reference as its idempotency key, and each downstream operation also records the account ID and request reference.

## 2. Consumer experience and timing

The API returns a request reference and an acknowledgement message after verification. It does not promise that every system is empty at that instant. The account UI shows the reference and a general in-progress message, and the support console can look up the same reference.

### 2.1 Verification and holds

A signed-in user starts in the account settings page and confirms the action with a recent password or device challenge. A session older than twelve hours must complete the challenge again. The API checks that the account is not already closed and creates one request for the current account ID.

The hold decision is made by Privacy Operations before the request is queued when the case system marks a legal hold. The worker checks the hold flag before each destructive operation. A held request remains visible to the operations export and is resumed only by an authorized case transition.

### 2.2 Deadline calculation

The service commits to completing a verified request within 30 business days. The due date is calculated in the Account service using the deployment region's holiday calendar; weekends and listed public holidays are excluded. If the due date is reached while a downstream operation is still retrying, the request is escalated to the Identity on-call and remains in progress until the worker succeeds.

The API records `verified_at` and `due_at` in UTC. Privacy Operations uses `due_at` for its queue and the user-facing message says that the request is handled within the committed period. A request placed on a legal hold pauses the due-date clock until the hold is released.

### 2.3 Scope resolution

At execution time the Account service creates a deletion plan from the account ID. The plan includes profile rows, credentials, sessions, device associations, application-owned objects, search documents, and downstream event references. Ledger records, abuse-prevention signals, active support cases, and items explicitly covered by a hold are marked as exceptions with their policy owner.

The plan is stored with a version of the inventory so that a later schema change cannot silently expand or shrink an in-flight operation. New account-owned data sources must register with Identity before they can launch in production.

## 3. Data removal plan

The worker executes the plan in dependency order. It first blocks new account activity, then deletes or tombstones the primary record, removes objects, and asks downstream systems to remove their copies. Each action is idempotent: an absent record is treated as a successful delete, while an authorization or validation error is recorded for retry.

### 3.1 Primary database and sessions

The Account service changes the account state to `deleting` in one transaction with the request reference. Login, profile edits, export creation, and new device registration reject a deleting account. The worker then removes ordinary profile, credential, consent, and device rows, using account ID predicates and foreign-key-safe ordering.

Redis sessions are revoked as part of the same Account service operation. A short-lived deny marker prevents an old session from being accepted during the propagation window. The deny marker expires after 24 hours, matching the session expiry policy. A transaction record lets a retry distinguish an already completed table operation from an authorization failure.

### 3.2 Snapshots and recovery copies

The worker removes live account records and object references. Database snapshots and object manifests remain managed by Infrastructure under the standard 90-day snapshot policy; the retention policy is unchanged by this design. Once the live-system actions complete, the request is considered complete and the account will not be restored to an active state by an ordinary recovery operation.

If Infrastructure restores a snapshot for a disaster-recovery exercise, the Account service applies the account state table before making the restored database available. The restored environment is restricted to the recovery team and is not connected to production traffic. This keeps disaster recovery predictable without adding snapshot-specific calls to every deletion worker.

### 3.3 Search and analytics propagation

The worker deletes the account's OpenSearch document through the Search service and publishes an `account-erased` event to the existing `account-events` topic. Search treats a missing document as success. The event carries the account ID, request reference, event version, and a deletion marker, but no profile values.

Data Platform consumes the existing account event stream as it does other account changes. Its normal warehouse retention and transformation jobs continue unchanged. The analytics warehouse is intended for reporting, not user-facing lookup, so the deletion worker does not wait for a warehouse query. Aggregated reports remain available because they have no account-level identity in their final form.

### 3.4 User content and outbound notifications

Object Storage content is removed through the storage gateway by account prefix. The gateway returns an operation ID for each batch and treats missing objects as successful. The worker records that ID and retries a batch when the gateway is temporarily unavailable. Export archives are included even if the user has never downloaded them.

The app sends a final in-product confirmation when the Account service reaches `completed`. Email delivery metadata remains available to the Notification service so that delivery and suppression reporting are not interrupted. The deletion worker does not call the Notification provider because notification credentials and provider traffic are owned by the Messaging team.

## 4. Orchestration and consistency

A coordinator in the Account service builds a plan and submits one message per request to the managed `account-deletion` queue. The message contains the request reference, account ID, plan version, and an attempt number. It contains no email address, name, or content payload.

### 4.1 Queue processing

The worker claims a message for ten minutes, executes the plan, and acknowledges the message after all actions in the plan return success. It uses exponential backoff for transient responses and gives up after eight attempts. A request that reaches the retry limit is moved to the queue's dead-letter stream for the daily operations review.

The API marks a request `queued` after the queue accepts the message and marks it `completed` when the worker has acknowledged it. The daily export reads the Account service state table. A worker restart is safe because each operation uses the request reference and account ID to find its prior result.

### 4.2 Ordering and retries

The primary state change happens before any destructive downstream call. This prevents a profile edit from racing with a delete. For an unavailable downstream service, the worker leaves the account in `executing`, records the response class, and retries with jitter. A permanent error leaves the request in `failed` and includes the service name for operations.

The message visibility timeout is ten minutes. The worker renews it while processing an unusually large object batch. If two workers see the same message, the Account service lease and downstream idempotency records prevent duplicate effects. A request cannot be restarted with a different plan version without an explicit operator action.

### 4.3 Partial completion and exceptions

A request may finish with exceptions when a ledger, abuse signal, support record, or legal hold requires continued retention. The completion response names the exception category and policy owner rather than exposing internal table names. Ordinary account data is not classified as an exception merely because a downstream service is slow.

The coordinator persists an action result for each plan entry. Operations can replay only a failed entry after checking that the account is still in a deleting state. Replays do not create a second request or change the original verification timestamp.

## 5. Audit and evidence

The Account service keeps a deletion record for 400 days so Privacy Operations can answer regulatory inquiries and reconcile requests after the normal product data is gone. The record is stored in the restricted evidence database and is readable by Privacy Operations and the Identity on-call role.

### 5.1 Recorded events

The evidence record contains request reference, account ID, verification result, actor type, `verified_at`, `due_at`, each state transition, action outcomes, exception categories, and completion time. Downstream services send a signed result containing the request reference, service name, result, and timestamp. The record includes a hash of the plan version so that a later reader can identify the exact set of actions used.

The audit writer is append-only for transitions. A correction is a new event linked to the original event, never an update that removes history. Access to evidence is logged separately, and automated exports contain request references and states rather than full account data.

### 5.2 Evidence record fields

For convenient support lookup, the deletion record also stores the email address and display name that were present when the request was verified. The values make it easier for an agent to recognize a customer in the support console if a request reference is unavailable. They are encrypted with the evidence database key and are removed when the 400-day evidence period ends.

The record is not used for marketing, search, or product activity. The support console masks the email address for most roles, while Identity on-call can view the full value during incident handling. The original user message is not copied into the evidence database.

## 6. Operations and rollout

The first rollout enables the request API for ten percent of traffic in one region for one week. Identity, Search, Media Platform, Data Platform, and Messaging each have an owner in the launch roster. The rollout expands region by region after the operations export contains a full week of completed requests and no unexplained state transitions.

### 6.1 Metrics and alerts

The service emits request counts by state, queue age, execution duration, retry count, downstream result class, and exception category. Alerts fire when queue age exceeds 30 minutes, when the completion target is missed, or when the dead-letter count changes from zero. The dashboard separates requests on legal hold from ordinary work.

The daily export includes request reference, account ID, state, verification time, due time, completion time, and exception category. Privacy Operations compares it with the intake system and assigns an owner to any missing or overdue request. The export is encrypted in transit and expires after 14 days.

### 6.2 Capacity and cost

At the expected peak of 140 requests per hour, the worker can process 500 in-flight requests with two replicas and a maximum batch of 50 objects per account. Autoscaling uses queue age and worker utilization, with a cap of eight replicas. The cap keeps the monthly worker spend within the $700 allocation; the broader deletion service budget is $4,200 per month.

Search and storage calls are rate-limited per account and globally. The worker yields between object batches and does not compete with interactive API traffic for the Account database connection pool. A load test uses a six-hour synthetic request burst and verifies that the queue returns below its target age.

## 7. Security and access control

Only an authenticated account owner or an authorized privacy operator can create a verified request. The API checks the current account ID from the session rather than trusting an ID in the request body. Operators must have the privacy-deletion role and a case reference. Service accounts receive only the permissions for their plan entries.

### 7.1 Secrets and payloads

Queue payloads contain identifiers and versioned control data, not personal content. The queue, evidence database, and service-to-service calls use platform encryption. Provider credentials remain in the owning service's secret store and are never copied into the worker configuration.

The worker validates plan version, account ID format, and request state before executing an action. It refuses a message whose request reference does not map to the claimed account. Logs redact account IDs unless the restricted deletion logger is enabled for a short incident window.

## 8. Verification and release

Unit tests cover each state transition and idempotent action. Integration tests run against disposable PostgreSQL, Redis, OpenSearch, object storage, and queue services. Contract tests validate the event schema and storage gateway responses. A pre-production run uses synthetic accounts with profile rows, sessions, objects, search documents, and warehouse events.

### 8.1 Failure tests

The test suite kills a worker before acknowledgement, returns throttling and timeout responses, delays event delivery, and submits duplicate requests. It verifies that no account becomes active again, that a retry does not duplicate an effect, and that a permanent error reaches the operations view. It also tests legal holds and exception-only records.

### 8.2 Data checks

After a synthetic request completes, a test query checks the primary and search systems and checks that object prefixes are empty. The release test records the observed state for the test account and rejects an invalid event version. Production operations rely on the Account state and daily export rather than querying each downstream system.

## 9. Alternatives and decision

A synchronous fan-out from the API was rejected because it would couple the user experience to the slowest provider and make retries harder. A scheduled batch was rejected because it would make due dates less predictable. The queue-based coordinator gives each service a bounded, auditable action and lets the existing on-call team operate it.

The Identity and Core Services team recommends approval for the regional rollout. The design reuses current service boundaries, keeps request payloads small, and gives Privacy Operations a stable reference for each request. After rollout, the team will review completion duration, exception rates, and operating cost before increasing the replica cap.
