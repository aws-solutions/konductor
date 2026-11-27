# Junk audit, 2026-11-24

Read-only audit. Nothing was deleted, moved or edited. This list is for the owner to review before any removal.

`<ws>` is the agent workspace (`KONDUCTOR_WS`). "Merged" means the worktree's
HEAD is already on `origin/feat/bench-pilot-nk` (checked with `git merge-base --is-ancestor`). "Refs" counts grep hits
for the path: "live" is `<ws>/scripts`, the ops checkout's `bench/` and `~/.kiro/crew/crons`; "reports" is `<ws>/reports`.
Sizes are `du -sh` at 18:20 EST.

## Totals

| Group | Lines | Size |
| --- | --- | --- |
| SAFE | 13 | about 5.3G |
| CHECK | 43 | about 5.6G |
| KEEP | 21 | not summed |

## SAFE (no references, clearly scratch)

| Path | Size | Why it looks like junk | Refs |
| --- | --- | --- | --- |
| `/var/tmp/konductor-standard-recheck/home.*` (15 dirs) | 4.7G total | Isolated kiro-cli HOMEs from recheck calls S1 to S7 (16:51 to 17:23). `run.sh` makes one per call; `rc-home.js clean` removes only the auth copy, so the dir (mostly `.local`, about 317M each) stays. Remove only while no recheck call runs (S8 is queued). | none by name; made by `run.sh:63` |
| `<ws>/worktrees/cc-compare` | 107M | Merged, clean, last commit 2026-11-23 | live 0, reports 0 |
| `<ws>/worktrees/konductor-2x2fix` | 36M | Merged, clean, detached, 2026-11-18 | live 0, reports 0 |
| `<ws>/worktrees/konductor-lane-bc` | 107M | Merged, clean, 2026-11-23 | live 0, reports 0 |
| `<ws>/worktrees/konductor-quality` | 37M | Merged, clean, detached, 2026-11-19 | live 0, reports 0 |
| `<ws>/worktrees/konductor-refactor` | 36M | Merged, clean, detached, 2026-11-18 | live 0, reports 0 |
| `<ws>/worktrees/konductor-trace` | 36M | Merged, clean, detached, 2026-11-17 | live 0, reports 0 |
| `<ws>/worktrees/konductor-plant/.worktrees/debt-nk` | 105M | Merged, clean, 2026-11-22 (same HEAD as `spotfix-nk`) | live 0, reports 0 |
| `<ws>/worktrees/konductor-plant/.worktrees/fill-nk` | 102M | Merged, clean, 2026-11-21 | live 0, reports 0 |
| git worktree record `<scratch>/02dba4a3/w1` | 0 | Dir is gone; git lists it as prunable (`git worktree prune` clears it) | none |
| `<ws>/reports/standard-recheck-results-2026-11-24.md` | 3.7K | Byte-identical copy of the tracked `bench/ops/workspace/standard-recheck/results-2026-11-24.md` | none to the reports copy; repo copy is referenced (KEEP) |
| `<ws>/reports/suite-folder-plan-2026-11-24.md` | 15K | Byte-identical copy of the tracked `bench/docs/history/suite-folder-plan-2026-11-24.md` | none to the reports copy; repo copy is referenced by D-257 (KEEP) |
| `<ws>/configure set --profile ...`, `<ws>/iam ...` (6 files) | 12K total | Stray files named after AWS CLI commands (2026-11-16 to 11-18): output redirected to a file by mistake. Hold IAM role JSON, CLI help text, or nothing. No secrets seen. | none |

## CHECK (referenced or unclear)

Worktrees that are merged and clean but were touched today, so another session may still use them:

| Path | Size | Why | Refs |
| --- | --- | --- | --- |
| `<ws>/worktrees/cc-team-plan` | 107M | Merged, last commit today | live 0, reports 0 |
| `<ws>/worktrees/std-plan` | 113M | Merged, today, same HEAD as `recheck-std` | live 0, reports 0 |
| `<ws>/worktrees/lane-gh` | 108M | Merged, today | live 0, reports 0 |
| `<ws>/worktrees/keyfix` | 107M | Merged, today | live 0, reports 2 |
| `<ws>/worktrees/konductor-fw3` | 109M | Merged, today, same HEAD as `debt-paid` | live 0, reports 1 |
| `<ws>/worktrees/recheck-debt` | 108M | Merged, today | live 0, reports 1 |

Worktrees that are merged and clean, named only in old reports:

| Path | Size | Refs |
| --- | --- | --- |
| `<ws>/worktrees/fw-def` | 107M | reports 1 |
| `<ws>/worktrees/konductor-2x2` | 38M | reports 167 (the 2x2 study) |
| `<ws>/worktrees/konductor-strands-real` | 36M | reports 2 |
| `<ws>/worktrees/wave2-bash` | 106M | reports 1 |
| `<ws>/worktrees/wave4-free` | 107M | reports 2 |
| `<ws>/worktrees/konductor-plant/.worktrees/fix2-nk` | 88M | reports 1 |
| `<ws>/worktrees/konductor-plant/.worktrees/judge-w5-12` | 102M | reports 7 |
| `<ws>/worktrees/konductor-plant/.worktrees/keyrec-nk` | 102M | reports 1 |
| `<ws>/worktrees/konductor-plant/.worktrees/kp-pilot-rerun` | 107M | reports 13 |
| `<ws>/worktrees/konductor-plant/.worktrees/recheck-nk` | 102M | reports 6 |
| `<ws>/worktrees/konductor-plant/.worktrees/recheck6-nk` | 104M | reports 2 |
| `<ws>/worktrees/konductor-plant/.worktrees/spotfix-nk` | 105M | reports 3 |

Worktrees that are merged and clean, named in live scripts, bench docs or crons (a removal may break a command):

| Path | Size | Refs |
| --- | --- | --- |
| `<ws>/worktrees/debt-paid` | 108M | live 1 |
| `<ws>/worktrees/konductor-debt5` | 106M | live 3, reports 15 |
| `<ws>/worktrees/konductor-arm` | 229M | live 1, reports 3 |
| `<ws>/worktrees/konductor-plant/.worktrees/arm-free-prep` | 108M | live 2, reports 6 |
| `<ws>/worktrees/konductor-plant/.worktrees/arm-test` | 105M | live 6, reports 16 |
| `<ws>/worktrees/konductor-plant/.worktrees/cc-check` | 107M | live 2, reports 6 |
| `<ws>/worktrees/konductor-plant/.worktrees/full-suite` | 108M | live 2, reports 14 |
| `<ws>/worktrees/konductor-plant/.worktrees/fw30` | 106M | live 1, reports 1 |
| `<ws>/worktrees/konductor-plant/.worktrees/kp-pilot` | 105M | live 1, reports 8 |
| `<ws>/worktrees/konductor-plant/.worktrees/kp-v2` | 107M | live 1, reports 6 |
| `<ws>/worktrees/konductor-plant/.worktrees/kp-v2-rerun` | 107M | live 1, reports 3 |
| `<ws>/worktrees/konductor-plant/.worktrees/ns-test` | 105M | live 1, reports 5 |
| `<ws>/worktrees/konductor-plant/.worktrees/nudge-nk` | 105M | live 1, reports 1 |

Other items:

| Path | Size | Why | Refs |
| --- | --- | --- | --- |
| `<ws>/worktrees/konductor-integ` | 1.8G | Branch `integration/2x2-local-v2` has 18 commits not on `feat/bench-pilot-nk` and not on origin ("not pushed"). Unique work: only remove after the owner says it is dead. | reports 112 |
| `<ws>/worktrees/mate` | 28M | Not konductor worktrees: two package snapshots (`ASDLCCoreAICapabilities-03db0add`, `SolNexusAICapabilities-d6996f3b`, 2026-11-15) and `konductor-plant-83f66913` (merged, local branch `crew/mate/konductor-plant`) | reports 35 |
| `/var/tmp/konductor-standard-recheck/results.before-fix` | 40K | First pass of S1 to S7 before the recheck fix. S3 and S7 match `results/`; S1, S2, S4, S5, S6 differ, so this is the only copy of those first-pass outputs. | none |
| `/var/tmp/konductor-standard-recheck/dry` | 5.3M | Dry-run work dirs S1 to S8 from 2026-11-23 | none |
| `/var/tmp/kvar-probe.*` | 0 | Nothing on disk matches this pattern. The closest is `/var/tmp/k3probe` below. | none |
| `/var/tmp/k3probe` | 7.6M | Probe dir from 2026-11-19 (pybin, kiro home, probe table) | reports 2 (`description-fix-validation-prompts-2026-11-19.md`, `pr-312-functional-test-2026-11-19.md`) |
| `/var/tmp/konductor-standard-v1-cache` | 576M | Outside the listed scope. 2026-11-23 cache, beside the newer `konductor-standard-v1/cache` | none |
| `/var/tmp/konductor-standard-v1-variants` | 13M | Outside the listed scope. 2026-11-23, beside the newer `konductor-standard-v1/variants` | none |
| `<ws>/reports/physical-ai-ideas-gcp-azure.md`, `<ws>/reports/physical-ai-solution-ideas.md` | 60K total | Older versions of the `-v2` files beside them | the `-v2` files name them |
| `<ws>/plant-release-r3-draft`, `-r4-draft`, `-r5-draft` | 120K each | Release drafts after r2; r2 is the release in use | `reports/konductor-plant-pilot-plan.md` |
| `<ws>/plant-bundle-draft`, `<ws>/plant-release-arm-draft` | 264K, 184K | Drafts; `plant-arm-release-cand` is the newer arm candidate | not checked one by one |
| `<ws>/plant-fields*.json` (5), `<ws>/plant-pilot`, `<ws>/plant-r3-notes` | 20K, 4K, 20K | Small run inputs and notes from 2026-11-16 to 11-18 | `reports/konductor-plant-pilot-plan.md` |

## KEEP (do not touch)

| Path | Size | Why |
| --- | --- | --- |
| `<ws>/worktrees/konductor-plant` | 2.3G | The main clone: every worktree above uses its `.git`. 4 uncommitted changes. Named in crons. |
| `<ws>/worktrees/ops` | 113M | The ops checkout the launchers run from. Its HEAD moved to `c75819f1` during this audit. |
| `<ws>/worktrees/t13-briefs` | 113M | Checked out on `feat/bench-pilot-nk` |
| `<ws>/worktrees/standard` | 113M | STANDARD study checkout; live ref |
| `<ws>/worktrees/recheck-std` | 112M | Recheck pin `cc72d0ae` (same as `pin.txt`); live refs |
| `<ws>/worktrees/pilot` | 102M | Live refs 16 |
| `<ws>/worktrees/lite-frozen-69149846`, `<ws>/worktrees/cc-frozen-69149846` | 102M each | Frozen pins; live refs |
| `<ws>/worktrees/konductor-plant/.worktrees/phys-nk` | 105M | Uncommitted `pinned-keys.json`; named in crons (live 9) |
| `<ws>/reports/lite-run-2026-11-21/judge/bench`, `.../bench-rejudge` | 102M, 105M | Registered worktrees that hold judged lite-run evidence |
| `/var/tmp/konductor-standard-recheck/calls` | 6.3M | Call outputs behind the credit ledger |
| `/var/tmp/konductor-standard-recheck/results` (incl. `S4.before-t3-v9.json`) | 36K | Live results; `run.sh` skips calls already here |
| `/var/tmp/konductor-standard-recheck/pin.txt` | 41B | Recheck pin |
| `/var/tmp/konductor-standard-v1` | 678M | Live STANDARD study dir, used at 18:19 today; `standard-kit-env.sh` and `run-standard-v1.sh` point here |
| `bench/scenarios/levels.js` | 1 line | Stand-in for the old path, tracked as D-257. Deleted 2026-11-27 when D-257 closed. |
| `bench/ops/workspace/standard-recheck/results-2026-11-24.md` | 3.7K | Tracked; named in `bench/ops/README.md` and `bench/scenarios/t3/HAND-EDITS.md` |
| `bench/docs/history/suite-folder-plan-2026-11-24.md` | 15K | Tracked; named in DEBT D-257 |
| `bench/docs/history/step0-findings.md`, `arm-step0-findings.md` | 58K, 11K | Tracked history; not duplicated elsewhere |
| `<ws>/reports/standard-recheck-2026-11-23.ledger` | 888B | Live recheck credit ledger (written 18:23) |
| `<ws>/plant-release-r1`, `<ws>/plant-release-r2`, `<ws>/plant-arm-release-cand`, `<ws>/plant-counted-set` | 140K, 168K, 132K, 5.8M | Signed releases and the counted set |
| `<ws>/scripts`, `<ws>/council`, `<ws>/reports/council` | 352K, 9.4M, 6.3M | Launchers and council records |
| `/var/tmp/*.lock`, `/var/tmp/konductor-heavy.lock.who` | 0 to 590B | Locks used by running jobs |

## Debt seen, not fixed (read-only audit)

`bench/ops/workspace/standard-recheck/run.sh` leaks one HOME per call (about 317M each): `rc-home.js clean` removes the
auth copy but not the dir. That is how the 4.7G of `home.*` built up. It needs a DEBT row and a fix that removes the
dir after the call.
