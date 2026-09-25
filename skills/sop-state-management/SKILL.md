---
name: sop-state-management
description: Use when authoring or running a long-running, multi-step SOP that must survive a crash or restart. Persists session state in a YAML file keyed by project identity, with per-phase status, skip reasons, completion summaries, and shared fix-cycle counters for parallel work.
version: 1.0.0
tags: [skill, session-state, resume, checklist, yaml, sop-infrastructure]
---

# SOP State Management

## Overview

Any SOP that runs long enough to be interrupted, whether by a crash, a restart, or an engineer stopping mid-run, needs a durable record of where it left off. This skill provides that record as a single YAML file per session: an identity signature so a later invocation can tell whether it is the same project continuing, a per-phase status map so a resumed run knows which phases are done, skipped, or still open, and a small set of named counters (fix-cycle budgets, or any other per-run or per-feature integer state) that survive interleaved parallel work without corruption.

This skill owns the file format, the identity/resume algorithm, and the read-modify-write mechanics. It has no opinion on what a "phase" or a "feature" means to the calling SOP. The calling SOP supplies the phase list, the identity inputs, and the counters it wants tracked, and reads this skill's output back through the same generic shape every time.

## Usage

Load this skill when:

- Designing a new SOP that spans multiple steps or phases and must be resumable after an interruption
- An existing SOP has ad hoc session-state logic (a hand-rolled state file, a bespoke resume check) and is being refactored onto a shared mechanism
- Reviewing whether a SOP's own state-tracking instructions duplicate something this skill already provides

## Core Concepts

### The Session Object

One file per session, at `{output_dir}/sessions/{session_prefix}-{timestamp}-{suffix}.yml` (see Mint Session below for `{suffix}`), holding three top-level keys. `project_signature` embeds the caller's normalized `description` verbatim and the canonicalized path, so this file can carry sensitive free text and local-layout information; on first write to `{output_dir}/sessions/`, if that directory is not already covered by `.gitignore`, append it (following the same check-and-append-on-first-write convention the `persistent-memory` skill uses for its own runtime-state directory). This sensitivity does not stop at the file boundary: Resume Discovery's attended-mode pause point and its unattended-mode return value both surface `project_signature` (and therefore the raw description and path it embeds) to whatever consumes them: an engineer's chat transcript in the attended case, or the calling SOP's own logs/summary in the unattended case. Treat that surfaced value with the same care as the file itself; the gitignore convention above does not travel with it once it is echoed elsewhere.

```yaml
run:
  schema_version: 1 # fixed constant this version of the skill writes and checks — see Resume Discovery
  project_signature: '<computed identity signature>'
  run_status: in_progress
  counters: {} # caller-defined named integer counters, e.g. doc_fix_cycles_used: 0
  data: {} # caller-defined opaque scalars/paths, e.g. e2e_project_dir: null, feature_isolation: branch
phases:
  <phase-id>:
    name: '<display name>'
    status: PENDING # PENDING | SKIPPED | IN_PROGRESS | COMPLETED | BLOCKED
    skip_reason: null # populated only when status is SKIPPED
    summary: null # populated only when status is COMPLETED
features:
  <feature-slug>:
    counters: {} # caller-defined named integer counters, e.g. fix_cycles_used: 0
    data: {} # caller-defined opaque scalars/paths, e.g. e2e_project_dir: null
```

`counters` and `data` are opaque bags. This skill does not validate their keys or content. The calling SOP defines what belongs in them (a fix-cycle budget, a bootstrapped E2E project directory, a feature-isolation mode) and owns its own semantics; this skill only guarantees they persist correctly across the operations below.

**`run.schema_version` guards against an incompatible-format file being silently misread, not against a hostile one.** It is a fixed integer constant this version of the skill mints and expects, not a caller-supplied value, and not a negotiated compatibility range. A file with no `schema_version` key can still parse cleanly under the restricted YAML loader and still match `project_signature`. The check exists specifically to catch this case rather than silently adopting an incompatible file. Without this field, such a file would be adopted as a genuine resume candidate, and every subsequent read against the new nested paths would silently return its own documented "unset" default (`0` for a counter, `null` for opaque data) instead of surfacing an error, quietly discarding real prior progress with no signal to the engineer. Resume Discovery therefore treats a missing or mismatched `schema_version` exactly like a sentinel-fingerprint collision: skip, record, never adopt (see Resume Discovery below).

**Two intentionally distinct status vocabularies.** `run.run_status` is lowercase (`in_progress` / `completed`) and has exactly two values. It answers one question: is this session still open? `phases.<phase-id>.status` is uppercase (`PENDING` / `SKIPPED` / `IN_PROGRESS` / `COMPLETED` / `BLOCKED`) and has five. It answers a different, per-phase question. Do not unify them; they track different things at different granularities, and a calling SOP's own checklist conventions typically already use the uppercase form for phase-level status, which this schema deliberately matches.

`<timestamp>` is ISO-8601 basic, lexically sortable (`2026-08-26T22-31-43`), minted once per session and never changed for the life of that session. Because the timestamp alone is only second-granularity, the filename also carries a short random suffix (see Mint Session below) so two concurrent mints for the same `session_prefix` within the same second cannot collide and silently overwrite each other.

### Identity and the Resume Signature

A resumed invocation must prove it is the same project continuing, not a different project that happens to share a description or a directory. Compute the signature once, at mint time, from three inputs the calling SOP supplies:

```
project_signature = {normalized description}::{canonicalized path}::{path_fingerprint}
```

- **Normalize the description**: trim leading/trailing whitespace, collapse internal whitespace runs to a single space, lowercase.
- **Canonicalize the path**: resolve it to its real path, with symlinks and mount aliases resolved using `realpath` semantics rather than merely made absolute, so two aliases of the same directory always canonicalize to the identical string.
- **Compute the path fingerprint**, in order: (1) if the path is a git repository AND `git -C "{path}" rev-list --max-parents=0 HEAD` — `{path}` MUST be passed as its own quoted argument (or as a discrete argv element in a non-shell invocation), never interpolated unquoted into a shell command string, so a path containing spaces or shell metacharacters cannot corrupt the command or be misinterpreted — succeeds and returns at least one root-commit SHA, sort the resulting SHA(s) lexically and join them with `,`; this identifies the repository's own lineage, not its current commit, so it stays stable across ordinary commits made during the run while still differing from any unrelated repository checked out at the same path; (2) otherwise — the path does not exist yet, exists but is not a git repository, or is a git repository whose `rev-list` invocation fails or returns no output (a freshly initialized repository with no commits yet — it has no `HEAD` to resolve, so this is a distinct, expected case, not a command error) — use the fixed sentinel string `no-git-identity`.

**The sentinel never proves identity on its own.** `no-git-identity` deliberately carries no distinguishing content. Two unrelated invocations that are both greenfield or both non-git can produce it identically. A resume candidate whose fingerprint component is the sentinel MUST be treated as unresolved (see Resume Discovery below), never adopted on a signature match alone.

### Write Safety

Every write to the session file is temp-file-and-rename: write the full new content to a sibling temp file in the same directory, then rename it over the real path. A rename within one filesystem is atomic, so a crash mid-write leaves the prior version intact rather than a truncated one. The rename itself can still fail (e.g. a permissions error, a full disk). Check its result before reporting the write as successful; on failure, delete the orphaned temp file and surface a hard error rather than silently returning success with the prior version still in place.

**The temp file itself must never be an entry Resume Discovery's non-recursive listing would see.** A crash between finishing the temp-file write and completing the rename leaves that temp file behind — uncleaned, since the cleanup instruction above fires only when the write or rename call itself returns a failure, not when the process is killed outright. If the temp file were written directly inside `{output_dir}/sessions/` with its name naively derived by appending a suffix to the real filename (e.g. `{session_prefix}-{timestamp}-{suffix}.yml.tmp`), it would still begin with `{session_prefix}` immediately followed by a digit and satisfy Resume Discovery's own candidate filter — and, because it is lexically _greater_ than the real file it is a suffix of, a descending-first sort would walk it _before_ the real file, not after. The temp file's own basename never protects it on its own: write it inside a subdirectory Resume Discovery's listing does not descend into instead — a sibling `.tmp/` directory under `{output_dir}/sessions/`, the same placement Concurrency scope requires for lock files below — so an orphaned one is excluded by never being listed at all, never mistaken for, or preferred over, the file it was about to replace.

When the calling SOP also maintains its own paired human-readable file (a checklist, a report) that should reflect the same update, the session-state file is always written first, then the caller's paired file second. This fixed order is what makes any post-crash disagreement one-directional and therefore reconcilable: the state file can be ahead of the paired file, never the reverse. This ordering is enforced, not merely stated: the two writes are dependent tasks, so per the `delegation-protocol` skill's sequencing rule, the calling SOP MUST NOT dispatch the paired-file write until the session-state write has returned confirmed success. The two writes are never issued in the same batch or in parallel.

## Execution

Apply the following operations exactly as described. A calling SOP invokes them by name from its own step instructions. This skill does not prescribe which agent performs the actual file I/O, only the algorithm and the resulting content.

### Operation: Compute Identity Signature

Input: `description` (free text), `path` (a filesystem path). Output: the `project_signature` string, per the algorithm above. Called once per invocation, before Resume Discovery.

### Operation: Resume Discovery

Input: `output_dir`, `session_prefix`, this invocation's own computed `project_signature`, and whether a reply channel exists (attended vs. unattended).

1. List `{output_dir}/sessions/` non-recursively: read only the entries directly inside it, and never descend into a subdirectory (e.g. `.locks/`, `.tmp/`, see Concurrency scope and Write Safety below); a subdirectory is excluded by this non-descent regardless of its own name or its contents' names. Filter the remaining, non-directory entries to filenames matching `{session_prefix}-<digit>...`: the prefix followed immediately by a digit, not by any other character. This excludes a differently-suffixed file sharing the same leading substring, which under lexical sort could otherwise be walked ahead of a correctly-named, newer file.
2. Sort the filtered list lexically descending (newest first).
3. Walk newest-to-oldest. For each candidate:
   - Parse with a restricted/safe YAML loader: one that produces only plain scalars, sequences, and mappings and refuses any other construct (custom tags, object construction, anchors resolving to non-data types). Since this file lives in a shared, filesystem-writable directory and unattended mode can adopt a match with no human in the loop, treat any construct beyond plain data as a parse failure, not a successfully parsed candidate.
   - If it fails to parse (truncated, corrupted, externally modified, or rejected by the restricted loader above), skip it and continue to the next-older candidate. Record it in this operation's output as a skipped-malformed path. A parse failure is never a hard error, and never stops the walk.
   - If it parses, apply the schema-version check before anything else: if `run.schema_version` is absent, or present but not equal to this skill's own current value, the file's schema is not one this version of the skill understands. A signature match on such a file is not safe to trust, since the nested `counters`/`data` paths this skill reads may not exist in it (see the Session Object's own note above for why this check exists). Skip it exactly as if it were malformed, record it in this operation's output as a skipped-schema-mismatch path (naming the file and, if present, its `schema_version` value), and continue to the next-older candidate.
   - If the schema version matches, apply a value-validation check: `run.run_status` MUST be exactly `in_progress` or `completed`, and every present `phases.<phase-id>.status` MUST be one of `PENDING`, `SKIPPED`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`. The restricted YAML loader guarantees only that these are plain scalars, not that their _values_ are valid. A hand-edited or externally-corrupted file can parse cleanly and match `schema_version` while still carrying an out-of-enum value (a typo, or a value borrowed from the wrong vocabulary; see the Session Object's own note above on the two distinct status vocabularies). Treat any such violation exactly like a schema mismatch: skip it, record it in this operation's output as a skipped-invalid-value path (naming the file and the offending field and value), and continue to the next-older candidate.
   - If the value-validation check passes, check whether `run.project_signature` exactly equals this invocation's computed signature AND `run.run_status` is not `completed`. If not, continue to the next-older candidate.
   - If it matches, apply the sentinel-fingerprint check: if this invocation's own fingerprint component is `no-git-identity`, the match alone does not prove identity. Skip it exactly as if it were malformed, record it in this operation's output as a skipped-sentinel-collision path, and continue to the next-older candidate.
   - The first candidate that parses, clears the schema-version check, clears the value-validation check, matches by signature and completion state, AND clears the sentinel check is the **resume candidate**.
4. If a resume candidate is found:
   - **No reply channel (unattended):** adopt it immediately and return its full parsed content.
   - **Reply channel exists (attended):** this is a pause point. Report the candidate's `project_signature`, `run_status`, absolute path, and (if the caller tracks features) every feature key in its `features` map, and wait for an explicit reply. On confirmation, adopt it and return its full parsed content. On decline, or a reply that does not confirm, treat this exactly as no match: continue the walk to the next-older candidate if one remains, or fall through to minting if none does.
5. If no candidate is found, whether because no file matches the prefix, every matching file belongs to a different project, or every matching file for this project is already `completed`, return a distinct not-found result (no session content). This operation does not mint on the caller's behalf: it has no `phase list` or `skip set` input to mint with (see Mint Session's own declared inputs below), so minting is the calling SOP's own responsibility, via its own separate call to the Mint Session operation using its own phase list and skip set.

**Naming a session file directly bypasses only the identity-and-completion check, not the parse/schema safety checks.** If the calling SOP's own caller (ultimately, the engineer) names a specific session file by exact path, resume that file, bypassing only the `project_signature`/`run_status`/sentinel-fingerprint match above. That check exists only to approximate the engineer's own explicit choice when they have not made one, and an explicit choice supersedes the approximation. The restricted-loader parse, the schema-version check, and the value-validation check still apply: a named file is still untrusted data in a shared, filesystem-writable directory (see the Overview and step 3 above), and adopting one that fails any of those checks is exactly the CRITICAL failure mode this operation's own Quality Gate exists to prevent. If the named file fails any of those checks, surface the failure rather than adopting it. Report its `project_signature` and `run_status` back regardless (once it has cleared those checks), so a mistaken reference to the wrong file is visible immediately.

### Operation: Mint Session

Input: `output_dir`, `session_prefix`, `project_signature`, a **phase list** (an ordered list of `{id, name}` pairs the calling SOP has in scope for this run), and a **skip set** (which of those phase ids are already known to be skipped at mint time, each with its own reason).

1. Create `{output_dir}/sessions/{session_prefix}-{timestamp}-{suffix}.yml`, where `{suffix}` is a short random collision-free identifier (e.g. an 8-hex-char UUID4 fragment) appended to guard against two concurrent mints landing on the same `{session_prefix}-{timestamp}` in the same second. Resume Discovery's `{session_prefix}-<digit>...` filter is unaffected, since it only anchors on the character immediately after the prefix. Populate it with:
   - `run.schema_version` set to this skill's current fixed value (see the Session Object's own note above), `run.project_signature` set to the given signature, `run.run_status` set to `in_progress`, `run.counters` and `run.data` empty. The caller populates the latter two via the counter and data operations below as its own fields become known.
   - `phases` populated with one entry per phase in the phase list, **before any phase has actually started**. This mirrors, inside the file, the same up-front population the calling SOP's own human-readable checklist performs before its first step runs. For each phase: `status: SKIPPED` with the caller-supplied `skip_reason` if the phase id is in the skip set, otherwise `status: PENDING` with `skip_reason: null` and `summary: null`.
   - `features` empty. The caller adds entries via the feature-registration operation below once it discovers what features exist.
2. Write it via the Write Safety mechanism above.

### Operation: Read/Write a Phase Entry

Input: `phase-id`, and, for a write, the new `status` and (depending on status) a `skip_reason` or `summary`.

- **Read:** return the current `{name, status, skip_reason, summary}` for that phase id.
- **Write:** set `status`. If the new status is `SKIPPED`, `skip_reason` MUST be provided and is written; `summary` is cleared to `null`. If the new status is `COMPLETED`, `summary` MUST be provided and is written; `skip_reason` is cleared to `null`. For `PENDING`, `IN_PROGRESS`, or `BLOCKED`, both `skip_reason` and `summary` are cleared to `null`. A phase's free-text detail belongs to whichever status it actually holds now, never held over from an earlier one. Then persist via the Write Safety mechanism.

This operation has no opinion on when a phase counts as done. A calling SOP with per-feature phases, meaning several independent workstreams that must each individually clear the same phase before the phase itself is complete, determines that aggregation itself and calls this write only once it has decided the phase-level status; this skill only stores what it is told.

### Operation: Register a Feature

Input: `feature-slug`. Creates `features.<feature-slug>` with `counters: {}` and `data: {}` if it does not already exist. Idempotent: registering an already-registered slug is a no-op, not an overwrite.

### Operation: Read/Increment a Counter

Input: a target (`run`, or a specific `features.<feature-slug>`), a `counter-name`, and whether this call is a plain read or a read-increment-write.

- **Read:** return the counter's current integer value (`0` if that target is already registered and that counter name has simply never been written on it; a target that is not registered at all is a distinct, out-of-scope precondition failure this operation does not itself resolve; see Register a Feature).
- **Read-increment-write:** read the current value, add 1, write the new value back, and return it. This is a single indivisible step from the caller's perspective.

**Concurrency scope (broader than "same counter"):** every operation in this skill that writes — a phase write, Register a Feature, a counter write, an opaque-data write — is a full-file read-modify-write against the ONE shared session file, not an isolated per-target or per-key update. Two such writes issued concurrently, even against _different_ targets or _different_ operation types, race on the same underlying file and can silently clobber each other exactly like two same-counter writes would. The calling SOP MUST therefore serialize ALL writes to a given session file — not merely same-target-and-counter-name calls — using a real mutual-exclusion primitive it holds across the whole read-modify-write cycle: an exclusively-created sibling lockfile (e.g. `mkdir {output_dir}/sessions/.locks/{session_prefix}-{timestamp}-{suffix}.lock` or an equivalent `open(..., O_CREAT|O_EXCL)` call under that same `.locks/` directory, released after the write lands) or an equivalent OS-level lock (e.g. `fcntl.flock` under that same directory, the same pattern the `mux-dispatch` skill's dispatch scripts already use for their own shared-registry read-modify-write). Place the lockfile inside a subdirectory Resume Discovery's non-recursive listing does not descend into — the `.locks/` directory shown above, under `{output_dir}/sessions/` — never as a bare `{session-file}.lock` sibling placed directly inside `{output_dir}/sessions/` itself, which would begin with `{session_prefix}` immediately followed by a digit and become a spurious Resume Discovery candidate the moment it were listed. The lockfile's own basename does not need to avoid that pattern; its subdirectory placement is what excludes it — a lockfile left behind after its lock is released, which happens even with correct cleanup code whenever the process is killed between the unlock and the unlink, must never be a candidate in the next Resume Discovery walk, and subdirectory placement is what guarantees that regardless of when cleanup runs. A caller MUST NOT rely on this skill, or on a natural-language "don't overlap calls" instruction alone, to prevent the race — the primitive is the caller's responsibility to hold, not something this skill enforces internally. This applies even when several features are processed in parallel (see the calling SOP's own fix-cycle documentation for that scenario) — the lock is per session file, not per counter.

**Stale-lock recovery.** A bare lockfile created via `mkdir`/`O_CREAT|O_EXCL` is not released automatically if its holder crashes mid-cycle — unlike `fcntl.flock`, which the kernel releases on process death, a directory or file created this way persists until something explicitly removes it. Left unhandled, one crashed holder permanently blocks every future writer to that session file. A caller blocked on an existing lock MUST check the lock's last-modified time; once it exceeds a fixed 30-second staleness threshold, treat the lock as abandoned — its holder crashed rather than merely running long — and steal it. The steal itself MUST be TOCTOU-safe: immediately before removing the lock, re-read its modification time and compare it against the value observed when it was first judged stale; if the two differ, the holder renewed the lock in the interim (it is still alive and working) and the steal MUST be aborted, not forced. Only when the mtime is unchanged across that re-check may the stale lock be removed and reacquired — and reacquisition MUST itself use the same atomic exclusive-create primitive as the original lock (`mkdir` or `open(..., O_CREAT|O_EXCL)`), never an unconditional overwrite. This matters because more than one waiter can independently judge the same lock stale and observe the same unchanged mtime at once; the atomic create is what arbitrates between them — only one waiter's create succeeds, and every other waiter's create fails (`EEXIST`) because the winner's fresh lock is already back in place. A waiter whose reacquire attempt fails this way MUST NOT assume ownership or proceed as if it had won — it MUST fall back to waiting and re-checking the (now live, newly-owned) lock's mtime exactly as it would against any other held lock. A caller holding a lock through a legitimately long read-increment-write cycle SHOULD periodically renew its mtime if that cycle can plausibly exceed 30 seconds, so a slow-but-alive holder is never mistaken for a crashed one. A caller using `fcntl.flock` instead of a bare lockfile does not need any of this — the kernel already releases that lock on process death, which is why the primitive above lists it as an equivalent alternative.

### Operation: Read/Write Opaque Data

Input: a target (`run`, or a specific `features.<feature-slug>`), a `key`, and, for a write, a `value` (any scalar or path string, or `null`). Stores or retrieves an entry in that target's `data` map. This skill does not interpret the key or the value. It is the calling SOP's own field (an `e2e_project_dir`, a `feature_isolation` mode, or anything else it needs to persist across a resume).

- **Read of a key never written on that target:** return `null`. This is the same "absent means unset, not an error" contract the counter operation gives via its `0` default, and consistent with Mint Session initializing every target's `data` map empty rather than pre-populating it. A calling SOP that treats a `null` opaque-data read as "not yet recorded" (for example, deciding whether to bootstrap `e2e_project_dir` on a feature's first run) can rely on this return value rather than special-casing an undefined result.

### Operation: Finalize Run

Input: whether the caller's own completion condition was satisfied (a boolean the calling SOP computes from its own domain-specific quality gate). Sets `run.run_status` to `completed` if satisfied, otherwise leaves it `in_progress`. This is the only way `run_status` ever becomes `completed`. A run left with any phase or feature still open should never call this operation with `satisfied=true`.

## Pitfalls

- **Do not let the calling SOP hold state in memory only.** Every phase, counter, or data update must be written through this skill's operations immediately, not batched until the end of a run. A crash between updates should lose at most the update in flight, never everything since the last explicit write.
- **Do not skip the sentinel-fingerprint check.** A signature match alone is not identity proof when the fingerprint component is `no-git-identity`. Two greenfield or non-git invocations can collide on it trivially.
- **Do not skip the schema-version check.** A file with no `schema_version` key can still parse under the restricted YAML loader and still match `project_signature` exactly. A `run.schema_version` mismatch (including its absence) is the only signal that distinguishes an incompatible-schema file, and skipping this check silently discards that file's real prior progress as if it were unset.
- **Do not reuse a `skip_reason` or `summary` across a status change.** Writing a new status without clearing the other field's stale value leaves a `BLOCKED` phase still showing an old `summary`, or a re-opened `PENDING` phase still showing a stale `skip_reason`. The write operation's mandatory clearing rule exists to prevent exactly this.
- **Do not treat a malformed candidate as a hard failure.** Resume Discovery's job is to find the newest valid candidate; a corrupted file is skipped, not fatal, and is only ever reported, never raised as an error that halts the walk.
- **Do not invent domain aggregation inside this skill.** Whether a phase spanning several features is "done" is the calling SOP's own rule (see Read/Write a Phase Entry above). This skill stores the result, it does not compute it.
- **Do not assume "don't overlap calls" alone prevents a race.** Every write against the session file is a full-file read-modify-write; without the calling SOP holding a real lock (see Read/Increment a Counter's Concurrency scope) across the whole cycle, two concurrent writes of any kind, not just two same-counter increments, can silently clobber each other.
- **Do not assume at most one open, matching session ever exists.** Two concurrent invocations that both find no resume candidate (e.g. two engineers independently starting the same project, or a retry-on-timeout wrapper firing twice) each mint their own session file for the same project at nearly the same timestamp. Resume Discovery's walk stops at the first (newest) matching, non-completed candidate. It does not detect or reconcile an older, still-open sibling. If two such sessions coexist, the older one's progress is silently never resumed again once the newer one is found first; this skill provides no cross-session merge or conflict signal, so avoiding double-invocation is the calling SOP's or engineer's own responsibility.

## Quality Gate

**CRITICAL (must fix):**

- A write to the session file is not temp-file-and-rename
- A resume candidate is adopted despite a sentinel-fingerprint collision
- A resume candidate is adopted despite a missing or mismatched `run.schema_version`, including a file with no `schema_version` key that otherwise parses and matches `project_signature`
- A `COMPLETED` phase entry has no `summary`, or a `SKIPPED` phase entry has no `skip_reason`
- Two writes to the same session file overlap without the calling SOP holding a real mutual-exclusion primitive across the whole read-modify-write cycle. This covers any two writes (phase, feature registration, counter, or opaque-data), not only two read-increment-write calls against the same counter target
- A resume candidate is parsed with a loader that is not restricted to plain scalars/sequences/mappings
- A stolen lock skips the TOCTOU mtime re-check immediately before removal, or a lock is stolen before it exceeds the fixed 30-second staleness threshold
- A lockfile or a Write Safety temp file is placed directly inside `{output_dir}/sessions/` rather than inside a subdirectory Resume Discovery's listing does not descend into (e.g. `.locks/` or `.tmp/`), making it a spurious Resume Discovery candidate
- A resume candidate is adopted despite an out-of-enum `run.run_status` or `phases.<phase-id>.status` value

**IMPORTANT (should fix):**

- A calling SOP holds phase or counter state in memory across multiple steps instead of writing through this skill immediately
- A malformed candidate halts the resume walk instead of being skipped and recorded
- A calling SOP's own domain aggregation logic (e.g. per-feature phase completeness) is duplicated inside this skill instead of staying in the calling SOP
- A write's rename step failure is not checked, or an orphaned temp file from a failed rename is left behind
- The session-state-then-paired-file write order is stated but not enforced as a dependent, sequential dispatch
- A caller holding a lock through a legitimately long cycle never renews its mtime, risking a live holder being mistaken for a crashed one and stolen from

**SUGGESTION:**

- Could add a dry-run mode for Finalize Run that reports which condition would block completion, for the caller's own diagnostics
- Could add cross-session conflict detection when Resume Discovery's walk finds more than one still-open, signature-matching candidate

Present findings as: CRITICAL → IMPORTANT → SUGGESTION.
