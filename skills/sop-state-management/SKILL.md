---
name: sop-state-management
description: 'Use when writing or running an SOP that must resume after a crash: mints or resumes a YAML session file, tracks phase status, and serializes fix-cycle counters. Sessions are matched by project identity, phase status (pending, skipped, in-progress, completed, blocked) carries skip reasons and completion summaries, and counters stay correct across parallel work.'
version: 1.0.0
tags: [skill, session-state, resume, checklist, yaml, sop-infrastructure]
---

# SOP State Management

## Overview

Any SOP that runs long enough to be interrupted — a crash, a restart, an engineer stopping mid-run — needs a durable record of where it left off. This skill provides that record as a single YAML file per session: an identity signature so a later invocation can tell whether it is the same project continuing, a per-phase status map so a resumed run knows which phases are done, skipped, or still open, and a small set of named counters (fix-cycle budgets, or any other per-run or per-feature integer state) that survive interleaved parallel work without corruption.

This skill owns the file format, the identity/resume algorithm, and the read-modify-write mechanics. It has no opinion on what a "phase" or a "feature" means to the calling SOP — the calling SOP supplies the phase list, the identity inputs, and the counters it wants tracked, and reads this skill's output back through the same generic shape every time.

## Usage

Load this skill when:

- Designing a new SOP that spans multiple steps or phases and must be resumable after an interruption
- An existing SOP has ad hoc session-state logic (a hand-rolled state file, a bespoke resume check) and is being refactored onto a shared mechanism
- Reviewing whether a SOP's own state-tracking instructions duplicate something this skill already provides

## Core Concepts

### The Session Object

One file per session, at `{output_dir}/sessions/{session_prefix}-{timestamp}-{suffix}.yml` (see Mint Session in `references/operations.md` for `{suffix}`), holding three top-level keys. `project_signature` embeds the caller's normalized `description` verbatim and the canonicalized path, so this file can carry sensitive free text and local-layout information; on first write to `{output_dir}/sessions/`, if that directory is not already covered by `.gitignore`, append it (following the same check-and-append-on-first-write convention the `persistent-memory` skill uses for its own runtime-state directory). This sensitivity does not stop at the file boundary: Resume Discovery's attended-mode pause point and its unattended-mode return value both surface `project_signature` (and therefore the raw description and path it embeds) to whatever consumes them — an engineer's chat transcript in the attended case, or the calling SOP's own logs/summary in the unattended case. Treat that surfaced value with the same care as the file itself; the gitignore convention above does not travel with it once it is echoed elsewhere.

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

`counters` and `data` are opaque bags — this skill does not validate their keys or content. The calling SOP defines what belongs in them (a fix-cycle budget, a bootstrapped E2E project directory, a feature-isolation mode) and owns its own semantics; this skill only guarantees they persist correctly across the operations below.

**`run.schema_version` guards against an incompatible-format file being silently misread, not against a hostile one.** It is a fixed integer constant this version of the skill mints and expects — not a caller-supplied value, and not a negotiated compatibility range. A file with no `schema_version` key can still parse cleanly under the restricted YAML loader and still match `project_signature` — the check exists specifically to catch this case rather than silently adopting an incompatible file. Without this field, such a file would be adopted as a genuine resume candidate, and every subsequent read against the new nested paths would silently return its own documented "unset" default (`0` for a counter, `null` for opaque data) instead of surfacing an error — quietly discarding real prior progress with no signal to the engineer. Resume Discovery therefore treats a missing or mismatched `schema_version` exactly like a sentinel-fingerprint collision: skip, record, never adopt (see Resume Discovery in `references/operations.md`).

**Two intentionally distinct status vocabularies.** `run.run_status` is lowercase (`in_progress` / `completed`) and has exactly two values — it answers one question: is this session still open? `phases.<phase-id>.status` is uppercase (`PENDING` / `SKIPPED` / `IN_PROGRESS` / `COMPLETED` / `BLOCKED`) and has five — it answers a different, per-phase question. Do not unify them; they track different things at different granularities, and a calling SOP's own checklist conventions typically already use the uppercase form for phase-level status, which this schema deliberately matches.

`<timestamp>` is ISO-8601 basic, lexically sortable (`2026-08-26T22-31-43`), minted once per session and never changed for the life of that session. Because the timestamp alone is only second-granularity, the filename also carries a short random suffix (see Mint Session in `references/operations.md`) so two concurrent mints for the same `session_prefix` within the same second cannot collide and silently overwrite each other.

### Identity and the Resume Signature

A resumed invocation must prove it is the same project continuing, not a different project that happens to share a description or a directory. Compute the signature once, at mint time, from three inputs the calling SOP supplies:

```
project_signature = {normalized description}::{canonicalized path}::{path_fingerprint}
```

- **Normalize the description**: trim leading/trailing whitespace, collapse internal whitespace runs to a single space, lowercase.
- **Canonicalize the path**: resolve it to its real path — symlinks and mount aliases resolved, `realpath` semantics, not merely made absolute — so two aliases of the same directory always canonicalize to the identical string.
- **Compute the path fingerprint**, in order: (1) if the path is a git repository AND `git -C "{path}" rev-list --max-parents=0 HEAD` — `{path}` MUST be passed as its own quoted argument (or as a discrete argv element in a non-shell invocation), never interpolated unquoted into a shell command string, so a path containing spaces or shell metacharacters cannot corrupt the command or be misinterpreted — succeeds and returns at least one root-commit SHA, sort the resulting SHA(s) lexically and join them with `,`; this identifies the repository's own lineage, not its current commit, so it stays stable across ordinary commits made during the run while still differing from any unrelated repository checked out at the same path; (2) otherwise — the path does not exist yet, exists but is not a git repository, or is a git repository whose `rev-list` invocation fails or returns no output (a freshly initialized repository with no commits yet — it has no `HEAD` to resolve, so this is a distinct, expected case, not a command error) — use the fixed sentinel string `no-git-identity`.

**The sentinel never proves identity on its own.** `no-git-identity` deliberately carries no distinguishing content — two unrelated invocations that are both greenfield or both non-git can produce it identically. A resume candidate whose fingerprint component is the sentinel MUST be treated as unresolved (see Resume Discovery in `references/operations.md`), never adopted on a signature match alone.

### Write Safety

Every write to the session file is temp-file-and-rename: write the full new content to a sibling temp file in the same directory, then rename it over the real path. A rename within one filesystem is atomic, so a crash mid-write leaves the prior version intact rather than a truncated one. The rename itself can still fail (e.g. a permissions error, a full disk) — check its result before reporting the write as successful; on failure, delete the orphaned temp file and surface a hard error rather than silently returning success with the prior version still in place.

**The temp file itself must never be an entry Resume Discovery's non-recursive listing would see.** A crash between finishing the temp-file write and completing the rename leaves that temp file behind — uncleaned, since the cleanup instruction above fires only when the write or rename call itself returns a failure, not when the process is killed outright. If the temp file were written directly inside `{output_dir}/sessions/` with its name naively derived by appending a suffix to the real filename (e.g. `{session_prefix}-{timestamp}-{suffix}.yml.tmp`), it would still begin with `{session_prefix}` immediately followed by a digit and satisfy Resume Discovery's own candidate filter — and, because it is lexically _greater_ than the real file it is a suffix of, a descending-first sort would walk it _before_ the real file, not after. The temp file's own basename never protects it on its own: write it inside a subdirectory Resume Discovery's listing does not descend into instead — a sibling `.tmp/` directory under `{output_dir}/sessions/`, the same placement Concurrency scope (in `references/operations.md`) requires for lock files — so an orphaned one is excluded by never being listed at all, never mistaken for, or preferred over, the file it was about to replace.

When the calling SOP also maintains its own paired human-readable file (a checklist, a report) that should reflect the same update, the session-state file is always written first, then the caller's paired file second. This fixed order is what makes any post-crash disagreement one-directional and therefore reconcilable: the state file can be ahead of the paired file, never the reverse. This ordering is enforced, not merely stated: the two writes are dependent tasks, so per the `delegation-protocol` skill's sequencing rule, the calling SOP MUST NOT dispatch the paired-file write until the session-state write has returned confirmed success — the two writes are never issued in the same batch or in parallel.

## Execution

Apply the following operations exactly as described. A calling SOP invokes them by name from its own step instructions — this skill does not prescribe which agent performs the actual file I/O, only the algorithm and the resulting content.

Open `references/operations.md` (relative to this file) when implementing a specific operation: Compute Identity Signature, Resume Discovery, Mint Session, Read/Write a Phase Entry, Register a Feature, Read/Increment a Counter (with its concurrency scope and stale-lock recovery rules), Read/Write Opaque Data, or Finalize Run.

## Pitfalls

- **Do not let the calling SOP hold state in memory only.** Every phase, counter, or data update must be written through this skill's operations immediately, not batched until the end of a run — a crash between updates should lose at most the update in flight, never everything since the last explicit write.
- **Do not skip the sentinel-fingerprint check.** A signature match alone is not identity proof when the fingerprint component is `no-git-identity` — two greenfield or non-git invocations can collide on it trivially.
- **Do not skip the schema-version check.** A file with no `schema_version` key can still parse under the restricted YAML loader and still match `project_signature` exactly — a `run.schema_version` mismatch (including its absence) is the only signal that distinguishes an incompatible-schema file, and skipping this check silently discards that file's real prior progress as if it were unset.
- **Do not reuse a `skip_reason` or `summary` across a status change.** Writing a new status without clearing the other field's stale value leaves a `BLOCKED` phase still showing an old `summary`, or a re-opened `PENDING` phase still showing a stale `skip_reason` — the write operation's mandatory clearing rule exists to prevent exactly this.
- **Do not treat a malformed candidate as a hard failure.** Resume Discovery's job is to find the newest valid candidate; a corrupted file is skipped, not fatal, and is only ever reported, never raised as an error that halts the walk.
- **Do not invent domain aggregation inside this skill.** Whether a phase spanning several features is "done" is the calling SOP's own rule (see Read/Write a Phase Entry in `references/operations.md`) — this skill stores the result, it does not compute it.
- **Do not assume "don't overlap calls" alone prevents a race.** Every write against the session file is a full-file read-modify-write; without the calling SOP holding a real lock (see Read/Increment a Counter's Concurrency scope in `references/operations.md`) across the whole cycle, two concurrent writes of any kind — not just two same-counter increments — can silently clobber each other.
- **Do not assume at most one open, matching session ever exists.** Two concurrent invocations that both find no resume candidate (e.g. two engineers independently starting the same project, or a retry-on-timeout wrapper firing twice) each mint their own session file for the same project at nearly the same timestamp. Resume Discovery's walk stops at the first (newest) matching, non-completed candidate — it does not detect or reconcile an older, still-open sibling. If two such sessions coexist, the older one's progress is silently never resumed again once the newer one is found first; this skill provides no cross-session merge or conflict signal, so avoiding double-invocation is the calling SOP's or engineer's own responsibility.

## Quality Gate

**CRITICAL (must fix):**

- A write to the session file is not temp-file-and-rename
- A resume candidate is adopted despite a sentinel-fingerprint collision
- A resume candidate is adopted despite a missing or mismatched `run.schema_version` — including a file with no `schema_version` key that otherwise parses and matches `project_signature`
- A `COMPLETED` phase entry has no `summary`, or a `SKIPPED` phase entry has no `skip_reason`
- Two writes to the same session file overlap without the calling SOP holding a real mutual-exclusion primitive across the whole read-modify-write cycle — this covers any two writes (phase, feature registration, counter, or opaque-data), not only two read-increment-write calls against the same counter target
- A resume candidate is parsed with a loader that is not restricted to plain scalars/sequences/mappings
- A stolen lock skips the TOCTOU mtime re-check immediately before removal, or a lock is stolen before it exceeds the fixed 30-second staleness threshold
- A lockfile or a Write Safety temp file is placed directly inside `{output_dir}/sessions/` rather than inside a subdirectory Resume Discovery's listing does not descend into (e.g. `.locks/` or `.tmp/`) — making it a spurious Resume Discovery candidate
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
