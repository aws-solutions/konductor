# Live worker configuration

## Context

Harbor Hand currently assembles configuration once and several consumers retain values captured during module initialization. Operators need a safe way to change worker tuning while a process continues to drain its queue. The design keeps the existing file and environment contract and makes one immutable value the unit passed to a job.

## Decisions

A `ConfigReloader` owns the current immutable `WorkerConfig`. It reads `config/worker.json` and `config/limits.json`, applies environment values after the file merge, rejects unknown keys and invalid values, and only assigns the new frozen object after all checks pass. A rejected read, parse, schema, unknown-key, or environment error returns the prior object and does not notify change listeners.

Each job captures one object through `withSnapshot`. A handler may await and may call several config-dependent helpers, but it receives the same object for the whole job. Poller and runner consumers ask the reloader for a snapshot instead of destructuring values when their modules load. This avoids a job combining an old timeout with a new attempt limit during a swap.

SIGHUP calls `reload('sighup')` immediately. File notifications are coalesced with a 100 millisecond trailing debounce, so a temporary empty file during a two-step editor save is not treated as the lasting candidate. `flushPending` makes this boundary deterministic for tests and operators. A later invalid candidate can never replace the last accepted object.

The file watcher reloads worker tuning, limits, logging, queue selection, region, and concurrency. Code, package metadata, broker credentials, and deployment topology remain restart or deployment concerns because they are not values in the supported schema. The watcher is stopped with the service and listener cleanup is explicit.

## Risks and operations

An imported helper that still keeps a scalar can silently ignore a good reload. The changed consumers therefore receive a source object at the job boundary, and tests exercise both poller settings and a multi-read handler.

A burst of file events can create excess parses or expose an intermediate write. The trailing debounce is paired with parse validation, and the reload error counter records rejected attempts without changing the active snapshot.

Environment values can surprise an operator who edits only JSON. The precedence is documented and tested: a supplied `WORKER_*` value wins over its file value, while an unset variable leaves the file value alone.

The change listener is observational, not a mutation hook. It receives previous, current, changed keys, and reason after the atomic assignment, so a listener failure cannot create a partially visible configuration.

## Failure and compatibility boundaries

An invalid initial bundle is a startup error; the process must not invent defaults or begin consuming jobs. Reload calls are synchronous around candidate construction, so two signal or file callbacks cannot interleave assignment. A valid candidate with no effective key change is accepted without a change notification. The integration records accepted and rejected counts and changed keys, but never records secret values. It logs file-read failures as codes and checks that the configured paths stay within the service configuration root rather than following an operator-supplied path. During a mixed-ring rollout, old processes continue with startup behavior and new processes can be disabled through the flag; both use the same schema and queue contract. Shutdown closes the watcher and pending timer before the process exits.

## Evidence

The existing configuration guide records the file split and environment precedence. The schema module shows the current permissive validation boundary, the runner captures settings at import, and the job executor reads two values independently. The runbook describes the temporary empty-file state of editor saves.

```json
{
  "decisions": [
    { "topic": "job snapshot boundary", "choice": "capture one immutable configuration snapshot for each job through withSnapshot", "reason": "all reads in a running job use the same object" },
    { "topic": "validation", "choice": "validate worker.json and limits.json with CONFIG_UNKNOWN_KEY strict rejection before assignment", "reason": "a typo must not become an accepted setting" },
    { "topic": "rollback", "choice": "keep the last accepted snapshot when read, parse, schema, unknown-key, or environment validation fails", "reason": "bad edits must not interrupt healthy work" },
    { "topic": "precedence", "choice": "merge file values first and apply WORKER_ environment variables after the file values", "reason": "the existing operator contract remains unchanged" },
    { "topic": "file events", "choice": "use a trailing 100 millisecond debounce and guard a zero bytes empty intermediate candidate", "reason": "two-step saves can expose an empty intermediate file" },
    { "topic": "reload boundary", "choice": "reload supported worker tuning and keep code, credentials, and topology restart-bound", "reason": "only schema-backed values have safe runtime semantics" },
    { "topic": "consumer access", "choice": "pass a reloader source into the poller and runner and use a job snapshot source", "reason": "every consumer must observe the shared current snapshot" }
  ],
  "risks": [
    { "risk": "a job can mix timeout and maxAttempts values if separate reads replace one snapshot", "mitigation": "capture once at the job boundary and pass that object through all helper calls" },
    { "risk": "a burst of watcher events can parse a transient empty or partial file", "mitigation": "coalesce notifications and leave the previous snapshot active on any failed candidate" },
    { "risk": "an environment value can hide a file edit", "mitigation": "show the precedence in operator documentation and expose changed keys after the effective merge" },
    { "risk": "a listener can throw after a swap", "mitigation": "assign the validated object before notifying and isolate listener failures in the service integration" }
  ],
  "evidence": ["docs/config.md:3", "docs/config.md:5", "docs/config.md:7", "docs/runbook.md:13"]
}
```