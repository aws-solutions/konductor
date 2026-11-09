# Operations

Read this before performing any operation below. The Overview, Session Object, Identity Signature, Write Safety and Quality Gate sections it points to are in `SKILL.md`.

### Operation: Compute Identity Signature

Input: `description` (free text), `path` (a filesystem path). Output: the `project_signature`
string, per Identity and the Resume Signature in `SKILL.md`. Called once per invocation, before Resume Discovery.

### Operation: Resume Discovery

Input: `output_dir`, `session_prefix`, this invocation's own computed `project_signature`, and
whether a reply channel exists (attended vs. unattended).

1. List `{output_dir}/sessions/` non-recursively — read only the entries directly inside it, and
   never descend into a subdirectory (e.g. `.locks/`, `.tmp/`, see Concurrency scope under Read/Increment a Counter
   below and Write Safety in `SKILL.md`); a subdirectory is excluded by this non-descent regardless of its own name or its
   contents' names. Filter the remaining, non-directory entries to filenames matching
   `{session_prefix}-<digit>...` — the prefix followed immediately by a digit, not by any other
   character. This excludes a differently-suffixed file sharing the same leading substring, which
   under lexical sort could otherwise be walked ahead of a correctly-named, newer file.
2. Sort the filtered list lexically descending (newest first).
3. Walk newest-to-oldest. For each candidate:
   - Parse with a restricted/safe YAML loader — one that produces only plain scalars, sequences, and
     mappings and refuses any other construct (custom tags, object construction, anchors resolving
     to non-data types). Since this file lives in a shared, filesystem-writable directory and
     unattended mode can adopt a match with no human in the loop, treat any construct beyond plain
     data as a parse failure, not a successfully parsed candidate.
   - If it fails to parse (truncated, corrupted, externally modified, or rejected by the restricted
     loader above), skip it and continue to the next-older candidate. Record it in this operation's
     output as a skipped-malformed path — a parse failure is never a hard error, and never stops the
     walk.
   - If it parses, apply the schema-version check before anything else: if `run.schema_version` is
     absent, or present but not equal to this skill's own current value, the file's schema is not
     one this version of the skill understands — a signature match on such a file is not safe to
     trust, since the nested `counters`/`data` paths this skill reads may not exist in it (see the
     Session Object's own note in `SKILL.md` for why this check exists). Skip it exactly as if it were
     malformed, record it in this operation's output as a skipped-schema-mismatch path (naming the
     file and, if present, its `schema_version` value), and continue to the next-older candidate.
   - If the schema version matches, apply a value-validation check: `run.run_status` MUST be exactly
     `in_progress` or `completed`, and every present `phases.<phase-id>.status` MUST be one of
     `PENDING`, `SKIPPED`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`. The restricted YAML loader
     guarantees only that these are plain scalars, not that their _values_ are valid — a hand-edited
     or externally-corrupted file can parse cleanly and match `schema_version` while still carrying
     an out-of-enum value (a typo, or a value borrowed from the wrong vocabulary — see the Session
     Object's own note in `SKILL.md` on the two distinct status vocabularies). Treat any such violation
     exactly like a schema mismatch: skip it, record it in this operation's output as a
     skipped-invalid-value path (naming the file and the offending field and value), and continue to
     the next-older candidate.
   - If the value-validation check passes, check whether `run.project_signature` exactly equals this
     invocation's computed signature AND `run.run_status` is not `completed`. If not, continue to
     the next-older candidate.
   - If it matches, apply the sentinel-fingerprint check: if this invocation's own fingerprint
     component is `no-git-identity`, the match alone does not prove identity — skip it exactly as if
     it were malformed, record it in this operation's output as a skipped-sentinel-collision path,
     and continue to the next-older candidate.
   - The first candidate that parses, clears the schema-version check, clears the value-validation
     check, matches by signature and completion state, AND clears the sentinel check is the **resume
     candidate**.
4. If a resume candidate is found:
   - **No reply channel (unattended):** adopt it immediately. Return its full parsed content.
   - **Reply channel exists (attended):** this is a pause point. Report the candidate's
     `project_signature`, `run_status`, absolute path, and (if the caller tracks features) every
     feature key in its `features` map, and wait for an explicit reply. On confirmation, adopt it —
     return its full parsed content. On decline, or a reply that does not confirm, treat this
     exactly as no match: continue the walk to the next-older candidate if one remains, or fall
     through to minting if none does.
5. If no candidate is found — no file matches the prefix, every matching file belongs to a different
   project, or every matching file for this project is already `completed` — return a distinct
   not-found result (no session content). This operation does not mint on the caller's behalf: it
   has no `phase list` or `skip set` input to mint with (see Mint Session's own declared inputs
   below), so minting is the calling SOP's own responsibility, via its own separate call to the Mint
   Session operation using its own phase list and skip set.

**Naming a session file directly bypasses only the identity-and-completion check, not the
parse/schema safety checks.** If the calling SOP's own caller (ultimately, the engineer) names a
specific session file by exact path, resume that file, bypassing only the
`project_signature`/`run_status`/sentinel-fingerprint match above — that check exists only to
approximate the engineer's own explicit choice when they have not made one, and an explicit choice
supersedes the approximation. The restricted-loader parse, the schema-version check, and the
value-validation check still apply: a named file is still untrusted data in a shared,
filesystem-writable directory (see the Overview in `SKILL.md` and step 3 above), and adopting one that fails any
of those checks is exactly the CRITICAL failure mode this operation's own Quality Gate exists to
prevent. If the named file fails any of those checks, surface the failure rather than adopting it.
Report its `project_signature` and `run_status` back regardless (once it has cleared those checks),
so a mistaken reference to the wrong file is visible immediately.

### Operation: Mint Session

Input: `output_dir`, `session_prefix`, `project_signature`, a **phase list** (an ordered list of
`{id, name}` pairs the calling SOP has in scope for this run), and a **skip set** (which of those
phase ids are already known to be skipped at mint time, each with its own reason).

1. Create `{output_dir}/sessions/{session_prefix}-{timestamp}-{suffix}.yml`, where `{suffix}` is a
   short random collision-free identifier (e.g. an 8-hex-char UUID4 fragment) appended to guard
   against two concurrent mints landing on the same `{session_prefix}-{timestamp}` in the same
   second — Resume Discovery's `{session_prefix}-<digit>...` filter is unaffected, since it only
   anchors on the character immediately after the prefix. Populate it with:
   - `run.schema_version` set to this skill's current fixed value (see the Session Object's own note
     in `SKILL.md`), `run.project_signature` set to the given signature, `run.run_status` set to
     `in_progress`, `run.counters` and `run.data` empty — the caller populates the latter two via
     the counter and data operations below as its own fields become known.
   - `phases` populated with one entry per phase in the phase list, **before any phase has actually
     started** — this mirrors, inside the file, the same up-front population the calling SOP's own
     human-readable checklist performs before its first step runs. For each phase: `status: SKIPPED`
     with the caller-supplied `skip_reason` if the phase id is in the skip set, otherwise `status:
     PENDING` with `skip_reason: null` and `summary: null`.
   - `features` empty — the caller adds entries via the feature-registration operation below once it
     discovers what features exist.
2. Write it via the Write Safety mechanism in `SKILL.md`.

### Operation: Read/Write a Phase Entry

Input: `phase-id`, and, for a write, the new `status` and (depending on status) a `skip_reason` or
`summary`.

- **Read:** return the current `{name, status, skip_reason, summary}` for that phase id.
- **Write:** set `status`. If the new status is `SKIPPED`, `skip_reason` MUST be provided and is
  written; `summary` is cleared to `null`. If the new status is `COMPLETED`, `summary` MUST be
  provided and is written; `skip_reason` is cleared to `null`. For `PENDING`, `IN_PROGRESS`, or
  `BLOCKED`, both `skip_reason` and `summary` are cleared to `null` — a phase's free-text detail
  belongs to whichever status it actually holds now, never held over from an earlier one. Then
  persist via the Write Safety mechanism.

This operation has no opinion on when a phase counts as done. A calling SOP with per-feature phases
— several independent workstreams that must each individually clear the same phase before the phase
itself is complete — determines that aggregation itself and calls this write only once it has
decided the phase-level status; this skill only stores what it is told.

### Operation: Register a Feature

Input: `feature-slug`. Creates `features.<feature-slug>` with `counters: {}` and `data: {}` if it
does not already exist. Idempotent — registering an already-registered slug is a no-op, not an
overwrite.

### Operation: Read/Increment a Counter

Input: a target (`run`, or a specific `features.<feature-slug>`), a `counter-name`, and whether this
call is a plain read or a read-increment-write.

- **Read:** return the counter's current integer value (`0` if that target is already registered and
  that counter name has simply never been written on it; a target that is not registered at all —
  see Register a Feature — is a distinct, out-of-scope precondition failure this operation does not
  itself resolve).
- **Read-increment-write:** read the current value, add 1, write the new value back, and return it.
  This is a single indivisible step from the caller's perspective.

**Concurrency scope (broader than "same counter"):** every operation in this skill that writes — a
phase write, Register a Feature, a counter write, an opaque-data write — is a full-file
read-modify-write against the ONE shared session file, not an isolated per-target or per-key update.
Two such writes issued concurrently, even against _different_ targets or _different_ operation
types, race on the same underlying file and can silently clobber each other exactly like two
same-counter writes would. The calling SOP MUST therefore serialize ALL writes to a given session
file — not merely same-target-and-counter-name calls — using a real mutual-exclusion primitive it
holds across the whole read-modify-write cycle: an exclusively-created sibling lockfile (e.g. `mkdir
{output_dir}/sessions/.locks/{session_prefix}-{timestamp}-{suffix}.lock` or an equivalent `open(...,
O_CREAT|O_EXCL)` call under that same `.locks/` directory, released after the write lands) or an
equivalent OS-level lock (e.g. `fcntl.flock` under that same directory, the same pattern the
`mux-dispatch` skill's dispatch scripts already use for their own shared-registry
read-modify-write). Place the lockfile inside a subdirectory Resume Discovery's non-recursive
listing does not descend into — the `.locks/` directory shown above, under `{output_dir}/sessions/`
— never as a bare `{session-file}.lock` sibling placed directly inside `{output_dir}/sessions/`
itself, which would begin with `{session_prefix}` immediately followed by a digit and become a
spurious Resume Discovery candidate the moment it were listed. The lockfile's own basename does not
need to avoid that pattern; its subdirectory placement is what excludes it — a lockfile left behind
after its lock is released, which happens even with correct cleanup code whenever the process is
killed between the unlock and the unlink, must never be a candidate in the next Resume Discovery
walk, and subdirectory placement is what guarantees that regardless of when cleanup runs. A caller
MUST NOT rely on this skill, or on a natural-language "don't overlap calls" instruction alone, to
prevent the race — the primitive is the caller's responsibility to hold, not something this skill
enforces internally. This applies even when several features are processed in parallel (see the
calling SOP's own fix-cycle documentation for that scenario) — the lock is per session file, not per
counter.

**Stale-lock recovery.** A bare lockfile created via `mkdir`/`O_CREAT|O_EXCL` is not released
automatically if its holder crashes mid-cycle — unlike `fcntl.flock`, which the kernel releases on
process death, a directory or file created this way persists until something explicitly removes it.
Left unhandled, one crashed holder permanently blocks every future writer to that session file. A
caller blocked on an existing lock MUST check the lock's last-modified time; once it exceeds a fixed
30-second staleness threshold, treat the lock as abandoned — its holder crashed rather than merely
running long — and steal it. The steal itself MUST be TOCTOU-safe: immediately before removing the
lock, re-read its modification time and compare it against the value observed when it was first
judged stale; if the two differ, the holder renewed the lock in the interim (it is still alive and
working) and the steal MUST be aborted, not forced. Only when the mtime is unchanged across that
re-check may the stale lock be removed and reacquired — and reacquisition MUST itself use the same
atomic exclusive-create primitive as the original lock (`mkdir` or `open(..., O_CREAT|O_EXCL)`),
never an unconditional overwrite. This matters because more than one waiter can independently judge
the same lock stale and observe the same unchanged mtime at once; the atomic create is what
arbitrates between them — only one waiter's create succeeds, and every other waiter's create fails
(`EEXIST`) because the winner's fresh lock is already back in place. A waiter whose reacquire
attempt fails this way MUST NOT assume ownership or proceed as if it had won — it MUST fall back to
waiting and re-checking the (now live, newly-owned) lock's mtime exactly as it would against any
other held lock. A caller holding a lock through a legitimately long read-increment-write cycle
SHOULD periodically renew its mtime if that cycle can plausibly exceed 30 seconds, so a
slow-but-alive holder is never mistaken for a crashed one. A caller using `fcntl.flock` instead of a
bare lockfile does not need any of this — the kernel already releases that lock on process death,
which is why the primitive above lists it as an equivalent alternative.

### Operation: Read/Write Opaque Data

Input: a target (`run`, or a specific `features.<feature-slug>`), a `key`, and, for a write, a
`value` (any scalar or path string, or `null`). Stores or retrieves an entry in that target's `data`
map. This skill does not interpret the key or the value — it is the calling SOP's own field (an
`e2e_project_dir`, a `feature_isolation` mode, or anything else it needs to persist across a
resume).

- **Read of a key never written on that target:** return `null` — the same "absent means unset, not
  an error" contract the counter operation gives via its `0` default, and consistent with Mint
  Session initializing every target's `data` map empty rather than pre-populating it. A calling SOP
  that treats a `null` opaque-data read as "not yet recorded" (for example, deciding whether to
  bootstrap `e2e_project_dir` on a feature's first run) can rely on this return value rather than
  special-casing an undefined result.

### Operation: Finalize Run

Input: whether the caller's own completion condition was satisfied — a boolean the calling SOP
computes from its own domain-specific quality gate. Sets `run.run_status` to `completed` if
satisfied, otherwise leaves it `in_progress`. This is the only way `run_status` ever becomes
`completed` — a run left with any phase or feature still open should never call this operation with
`satisfied=true`.
