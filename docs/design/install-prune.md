# Design note: removing source-dropped files on install

Date: 2026-09-26
Code: `cli/konductor-rs/src/cli/install/prune.rs`

## Problem

Every install strategy rewrites its manifest slot from what the current run wrote. When the
source drops content (the agent specs, the routing skills, a skill that moved from
`.konductor/skills/` to `.kiro/skills/`), the previous run's copies stayed on disk and fell out
of the manifest, so no later `uninstall` could find them. For this package that meant an
upgrade kept the old orchestrator and specialist agents installed.

## Invariants

1. Only a path the previous slot of this strategy recorded is ever a candidate; nothing is
   discovered by scanning the filesystem.
2. A candidate is deleted only if no slot in the manifest read under the lock names it, and the
   current run did not write it untracked.
3. The manifest read, every eligibility check, every deletion and the directory pruning happen
   inside one hold of the per-target manifest lock, the same lock every install takes before
   recording the paths it will write.
4. Content is deleted only when it is byte-identical to what the previous install recorded
   (hash match), was written by Konductor (`Created` or `ReplacedOurs`), is a regular file, and
   is not the shared `.claude/settings.json`.
5. Paths stay inside the target: normal components only, and no directory between the target and
   the file may be a symlink.
6. Pruning never removes the target, a runtime root (`.kiro`, `.konductor`, `.claude`) or
   `.kiro/skills`.
7. Any failure leaves files in place and never fails the install.

## Decision

Keep the pruner and continue patching it, rather than removing the invariant family or
rewriting the unit.

Removing it would reopen the original defect: an upgrade that leaves removed agents installed
and untracked. A different primitive, such as asking users to run `konductor uninstall` first,
was tried and rejected because the normal upgrade path does not include that step.

Rewriting it would not shrink the invariant list above. Each review finding on this unit named a
missing guard of an existing invariant (the lock for invariant 3, the ancestor check for
invariant 5), not a new invariant family, and each guard reuses a primitive the codebase already
uses for the same purpose: the manifest lock that `upsert_strategy` and
`delete_and_remove_strategy_locked` hold for their read-decide-act sections, and the
no-symlink rule the installers apply when copying.

The residual risk accepted by this decision is a directory swapped for a symlink between the
ancestor check and the deletion, by a process with write access to the install target. Closing
it needs directory-relative, no-follow file operations, which the codebase does not use
anywhere else; a process with that access can already change the installed content directly.

## Review obligations covered

This decision covers the open remediation obligations on source-dropped files (review findings
E1-R1-F11 and E1-R2-F11, including the symlinked-parent escape found in round 4) and the
concurrent-install race (E1-R3-F1). The runtime-discovery obligations (E1-R1-F1, E1-R2-F8,
E1-R3-F2) are covered separately by `tests/integration/kiro-agentless-discovery.sh`.
