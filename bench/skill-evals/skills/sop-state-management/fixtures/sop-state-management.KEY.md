# sop-state-management fixture key (tools/session_state.py)
- line 10 signature(): description only lowercased (no whitespace collapse/trim), path not canonicalized (realpath), no path fingerprint (git root-commit SHA / no-git-identity sentinel).
- line 17 mint(): filename has no random suffix -> two mints in the same second collide; no run.schema_version written; phases missing skip_reason/summary keys; no run.data.
- lines 27-29 _write() (open at line 28): writes in place with open(...,'w') -> not temp-file-and-rename (truncation on crash). Used by every write.
- line 36 discover(): name.startswith(prefix) without requiring a digit after "<prefix>-" (matches release-train-v2-...).
- line 39 discover(): yaml.load with yaml.Loader (unsafe loader) and no try/except -> a malformed file raises instead of being skipped.
- discover(): no schema_version check, no value/enum validation, no sentinel check; lists .tmp/.locks too.
- lines 45-54 set_phase(): COMPLETED allowed without summary, SKIPPED without skip_reason; stale summary/skip_reason not cleared on status change; status not validated against enum.
- lines 57-62 bump_counter(): read-modify-write with no lock while sops/release-train.sop.md runs parallel workers -> lost increments; no stale-lock handling.
- .gitignore not updated for the sessions dir.

v2 prompts: p1 rewrites tools/session_state.py in place (same public functions signature/mint/discover/set_phase/bump_counter used by sops/release-train.sop.md); p3 runs in the same fixture dir, which is not a git repo and contains the buggy module, so a strong answer does not just call the existing mint() (it would produce no schema_version, no random suffix, no skip_reason, no description normalization, no fingerprint). Expected p3 signature: "release train for payments-api::<realpath of cwd>::no-git-identity".
