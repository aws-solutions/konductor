# T8 hand edits

Owner rule (2026-11-19): every change to a task's prompt, fixture, key, checks or rubric by anyone other than the recorded author is logged here, and the task file carries `handEdited`. All edits below were made by the T8 worker, a Claude session (family claude, kirocrew-mate-worker on Kiro CLI), after the author call and before the dry run. Each row: task, files, what, why. The per-call record with credits is in `AUTHORING-LOG.md`.

A non-Claude recheck of these tasks against the owner checklist (no method or decoy named; the fixture does not list the answers; the key matches the fixture; solvable from the fixture alone) is still to run: the T7 and T8 rewrite spend stop was reached first. Until then `review.recheck` is absent.

## Version 1 tasks (kept)

| task | files | what changed and why |
| --- | --- | --- |
| t8-heldout-rollback-decision | hidden key | CV-E: the task is written by hand (Claude); after qwen3-coder-next's review the `harm-old-version-rate` tolerance went from 0.12 to 0.2 percentage points, because the 4.17.3 rate rests on 17 declines and a reader who ends the window at 14:00 instead of 14:29 UTC gets 0.56 % (the reviewer's own count); the lazy answer still scores 12.5 |
| t8-inc-checkout-latency | task file (prompt, checks, blockKey), fixture or solution as named | timeline matchers held literal times beside the time tolerance; the decoy pattern also rejected "deploy"; a config evidence group accepted only one of the change's lines; two exact-phrase and exact-line `contains` checks and a `fixture/` path prefix removed |
| t8-pm-cert-expiry-region | task file (prompt, checks, blockKey), fixture or solution as named | generator wrote a manifest with the seed into the fixture and named the later fix deploy "certfix"; both removed in the generator and the fixture regenerated (identical otherwise); decoy and timeline patterns widened to accept other phrasings; `fixture/` path prefix removed |
| t8-bug-retry-storm | task file (prompt, checks, blockKey), fixture or solution as named | request named the shared client as the fix location and the timing as the cause, and fixed a test file name; rewritten to symptom, evidence and contract only; an implementation-string `not_contains` check replaced by a count of test cases; regress test made one test (pass on fix and fail on original) |
| t8-inc-memory-leak | task file (prompt, checks, blockKey), fixture or solution as named | request hinted at the decoy ("distinguish correlation from cause") and left the impact numbers undefined; both fixed; narrow action and timeline patterns widened; evidence needs 2 of 3 groups; a secrets `not_contains` check that passed on the stub removed |
| t8-runbook-db-failover | task file (prompt, checks, blockKey), fixture or solution as named | key graded citations of the old incident at fixed step positions (`steps.0`, `steps.1`) and a storage diagnosis, which a runbook need not hold; removed with the citation ask; order items read the `command` field (a text match on "promot" hit "before promotion"); the delayed-replica item now fails only a promote command on it; abort limit at or below the RPO; a file-name `contains` and a numbered-list count removed |
| t8-dec-deploy-strategy | task file (prompt, checks, blockKey), fixture or solution as named | request listed every kind of source and asked for an incident cause with log lines, which a decision record need not hold; both removed with their two key items; constraint and option patterns reduced to number, topic and source file (exact phrases such as "health signal" removed); format-only checks replaced |
| t8-dec-deploy-strategy, t8-runbook-db-failover | task file (prompt, checks, blockKey), fixture or solution as named | expert key items that repeated what the hidden key checks (listed constraints, order of fence and promote, abort limit, revisit threshold) rewritten to ask for what code cannot check |
| t8-twin-latency-tier-report | task file (prompt, checks, blockKey), fixture or solution as named | request named paths with a `fixture/` prefix; a check used a `paths` list the schema does not have |
| t8-rollout-ledger-migration | task file (prompt, checks, blockKey), fixture or solution as named | the reviewer printed its verdicts instead of writing review.json (read from its reply; stage.js now does that itself); request listed every source file and named the metrics catalogue file; both reduced; every-step gate item limited to traffic steps; an exact canary start time replaced by "every step inside the release window"; decoy and rota patterns widened; a keyword `contains` check and a `fixture/` path prefix removed |
| t8-inc-queue-backlog | task file (prompt, checks, blockKey), fixture or solution as named | delayed-notification count defined in the request; root cause patterns accept "retried", "stuck" and "backlog"; decoy pattern fails only a summary that blames the disk; evidence needs 2 of 3 groups |
| t8-oncall-alert-review | task file (prompt, checks, blockKey), fixture or solution as named | each flawed-alert item required the reference's exact replacement values (thresholds, durations, an ack count) in 6 or 7 patterns; reduced to the alert name, the kind of problem and, where it is clear, the disposition; a log-citation item and two citation-format checks removed; request no longer lists every source |
| t8-nfr-slo-burn | task file (prompt, checks, blockKey), fixture or solution as named | request told the agent to exclude synthetic and health-check traffic and to use the catalogue and dependency notes (the seeded traps); removed, availability defined; the availability tolerance (0.05 points) accepted the all-traffic value 99.995, cut to 0.009; a log-citation check removed |
| t8-pm-cache-stampede | task file (prompt, checks, blockKey), fixture or solution as named | the request did not name the impact fields the key reads; named and defined; timeline items required words such as "first" and "third"; decoy pattern now fails only a summary that blames the reporting job; two keyword `contains` checks removed; evidence needs 2 of 3 groups |
| t8-tpm-rollout-regions | task file (prompt, checks, blockKey), fixture or solution as named | the request offered optional `risk.cause` and `risk.decoy` fields (naming the decoy) that the key graded; removed with their items and an optional canary field; a positional `steps.13` item, a "contract" item that matched the partner contract, and an exact certification start time replaced by "no Solmere step before the certification time"; order patterns widened; gate rule limited to traffic steps; grader gained `timeField` for that item |
| t8-rollout-ledger-migration | briefs/t8-rollout-ledger-migration.json (expertKey) | two expert key items (expand-contract, timing) rewritten; why: they repeated what the hidden key checks |
| t8-nfr-slo-burn | briefs/t8-nfr-slo-burn.json (expertKey) | three expert key items (user-sli, target-from-data, multiwindow) rewritten; why: they repeated what the hidden key checks |
| t8-tpm-rollout-regions | briefs/t8-tpm-rollout-regions.json (expertKey); prompt | two expert key items (critical-path, calendar) rewritten; the word "RACI" in the request replaced by "the responsibility sheet in this folder"; why: the items repeated the hidden key; the leak lint flags RACI as a method term |

## Dropped version 2 drafts

These drafts were hand-fixed before the owner rule that a second-family rewrite is never hand-fixed. Both failed the gates anyway and were dropped; version 1 stays.

| task | files | what changed and why |
| --- | --- | --- |
| t8-inc-memory-leak (v2) | task file, fixture, solution | request named the decoy and listed every source, and left the impact fields undefined; rewritten with the three fields defined; the tests check counted 30 tests for 18; action matchers read the whole item (owner text matched); two keyword `contains` checks removed |
| t8-pm-cert-expiry-region (v2, try 2) | task file, fixture, solution | fix round: the request said "not the deploy" and listed every source; the impact fields were undefined; the expired certificate's not-after date sat a month before the outage (moved to the outage start, by hand: this author wrote no generator); key patterns listed every word as required ("503" and "error" and "fail"); the reviewer's JSON was repaired by hand |

## D-97 re-weighting (T7 worker session, family claude, 2026-11-20)

No prompt, fixture or key changed. Only check weights and check commands in the task files.

| Task | What changed | Why |
| --- | --- | --- |
| t8-nfr-slo-burn (v2) | a new substance `cmd` check of weight 8 passes only when the block's `measured.availability28d` and `measured.latencyP99Ms` hold the values the hidden key checks (same tolerances: 0.009 and 5%); output exists 3 to 1 | the output-exists and unchanged-input checks gave a shallow answer the whole checks share; the new check ties that share to the two measurements the hidden key verifies |
| t8-neg-alert-threshold (v3) | the three `contains` checks (one per requested edit) became one `cmd` check that all three edits are in `rules/checkout-api.json`, weight 3 | an answer making two of the three edits earned two thirds of the checks share; the request asks for all three |

Dry run after the change, twice with the same scores: t8-nfr-slo-burn reference 100, stub 2.9, lazy 37.5, alt 100;
t8-neg-alert-threshold reference 100, stub 11.9, lazy 35.7, alt 88.1. Both now `pilot.decision` keep.

The other 13 cannot pass by re-weighting: their mechanical lazy answer meets enough hidden items that even with every
non-test check failing it would score over 40 (t8-tpm-rollout-regions 77.1, t8-runbook-db-failover 60.4,
t8-rollout-ledger-migration 59.3, t8-inc-checkout-latency 55.7, t8-pm-cert-expiry-region 54.2, t8-inc-memory-leak 53.4,
t8-dec-deploy-strategy 51.6, t8-oncall-alert-review 50.4, t8-inc-queue-backlog 46.5, t8-pm-cache-stampede 46.1,
t8-twin-latency-tier-report 42.9 or more), or their lazy and alternative answers score the same
(t8-neg-config-question, 79.6 each), or no alternative is recorded (t8-bug-retry-storm, lazy 72.1). Each keeps
`pilot.decision` fix with the reason in `pilot.scores.fixReason`, for a paid single fix by the original writer.

## Fix round by the FX job (2026-11-20)

t8-tpm-rollout-regions and t8-runbook-db-failover: the key was tightened by the original writer (gpt-5.6-luna), not by Claude, so no hand edit is added and `handEdited` is unchanged. Recheck by glm-5; calls and credits in AUTHORING-LOG.md.

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t8-inc-checkout-latency`: clear-causal-narrative given causal-chain Fail/Partial/Pass anchors.
- `t8-inc-memory-leak`: narrative-judgment given causal-chain Fail/Partial/Pass anchors.
- `t8-inc-queue-backlog`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): causal-chain.
- `t8-neg-alert-threshold`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): no-extra-scope.
- `t8-neg-config-question`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): answer-sourced.
- `t8-oncall-alert-review`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): alert-judgement.
- `t8-pm-cache-stampede`: narrative-clarity given causal-chain Fail/Partial/Pass anchors.
- `t8-pm-cert-expiry-region`: clear-review-narrative given causal-chain Fail/Partial/Pass anchors.
- `t8-twin-latency-tier-report`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): counting-rule-stated.

## Harder keys after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews (T5 mutant tasks saturated at 100 and rewarding suite size; 10 tasks whose lazy answer scored 68.9 to 84.7 against the 40 gate). Shared changes: lib/hidden/mutants.js and mutation.test.js (safe refactors, suite-size budget, kills count only for a suite that passes the refactor), lib/hidden/block-key.js and block.test.js, lib/hidden/plan.test.cjs (gate items, section scoring). Dry runs re-recorded. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t8-dec-deploy-strategy`: block key scored by section (constraints, decision (the call and the reasons each option was rejected)): each section earns all when complete, half with one item missed, nothing with more, so half a report earns little; gate decision-is-canary (a wrong cause or call fails every test); guard checks made format (file_exists decisions/0007-deploy-strategy.md, fixture_unchanged docs/capacity-report.md) because they pass on any answer that writes the file.
- `t8-inc-memory-leak`: block key scored by section (actions, cause, impact, timeline): each section earns all when complete, half with one item missed, nothing with more, so half a report earns little; gate cause-summary (a wrong cause or call fails every test); guard checks made format (file_exists incidents/search-oom-restarts.md, fixture_unchanged ops/metrics/container-search-08.csv) because they pass on any answer that writes the file.
- `t8-inc-queue-backlog`: block key scored by section (actions, cause, impact, timeline): each section earns all when complete, half with one item missed, nothing with more, so half a report earns little; gate cause-summary (a wrong cause or call fails every test); guard checks made format (file_exists incidents/notification-backlog.md, fixture_unchanged logs/consumer-a.log) because they pass on any answer that writes the file.
- `t8-oncall-alert-review`: block key scored by section (changes, hygiene, keeps): each section earns all when complete, half with one item missed, nothing with more, so half a report earns little; gate none (a wrong cause or call fails every test); guard checks made format (file_exists oncall/alert-review.md, fixture_unchanged alerts/alert-rules.yml) because they pass on any answer that writes the file.
- `t8-pm-cache-stampede`: block key scored by section (actions, cause, impact, timeline): each section earns all when complete, half with one item missed, nothing with more, so half a report earns little; gate cause-summary (a wrong cause or call fails every test); guard checks made format (file_exists postmortems/catalog-db-overload.md, fixture_unchanged logs/db.log) because they pass on any answer that writes the file.
- `t8-pm-cert-expiry-region`: block key scored by section (actions, cause, impact, timeline): each section earns all when complete, half with one item missed, nothing with more, so half a report earns little; gate root-cause-summary (a wrong cause or call fails every test); guard checks made format (file_exists postmortems/eu-login-outage.md, fixture_unchanged certs/certificate-inventory.csv) because they pass on any answer that writes the file.
- `t8-neg-config-question`: hidden shape tests (list, sorted, fields, unique, replica counts) now count only when the answer names exactly the debug services the renderer gives, so a wrong answer in the right shape earns nothing; alt answer fixed (it was unsorted, which the prompt forbids) and is now the reference with each record's keys in another order; guard checks made format (file_exists answers/prod-debug.json, fixture_unchanged config/production/catalog.json).
- `t8-twin-latency-tier-report`: hidden shape tests now count only when the totals match the /checkout records of the log, so a well-shaped report of wrong counts earns nothing; guard checks made format (file_exists reports/checkout-hourly.csv, file_exists reports/checkout-totals.json, fixture_unchanged logs/checkout-api.log).

## Rubric anchors (2026-11-20)

- Who: claude (review-fix2 worker)
- What: the 5 unanchored prose criteria (t8-bug-retry-storm evidence-use, t8-dec-deploy-strategy operational-clarity, t8-nfr-slo-burn decision-explanation, t8-runbook-db-failover usable-at-3am, t8-tpm-rollout-regions signoff-quality) now carry Fail / Partial / Pass anchors tied to the block key and fixture figures. Ids, weights and expert-key items are unchanged; task versions are up by 1.
- Why: the independent review found these criteria had no anchors.

## Non-Claude recheck (D-108, 2026-11-20, mate hand-edit recheck worker)

Every Claude hand edit above was checked again. Free first: the free gates (reference, empty, lazy, alternative) and
two scans (rubric anchors and hidden-test names found only in the reference, not in the request or fixture). Then a
non-Claude model ran the four-item checklist ("full": request, fixture, hidden key and rubric; "rubric": the rubric
edits, on top of the earlier non-Claude check of the request, fixture and key). Verdicts are in each task's
`review.recheck`; calls and credits in reports/hand-edit-recheck-2026-11-20.md.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t8-bug-retry-storm | none | fix needed | free gates: lazy 72.1 and no alternative answer (known, not ready); its call (c13) was throttled, so no new checklist |
| t8-dec-deploy-strategy | glm-5 (c11, full) | confirmed |  |
| t8-inc-checkout-latency | glm-5 (earlier, after the last edit) | confirmed |  |
| t8-inc-memory-leak | glm-5 (c11, full) | confirmed |  |
| t8-inc-queue-backlog | glm-5 (c11, full) | confirmed |  |
| t8-neg-alert-threshold | none | not checked | its call (c13) was throttled and returned nothing; the 300-credit cap was reached |
| t8-neg-config-question | glm-5 (c12, full) | confirmed |  |
| t8-nfr-slo-burn | none | not checked | its call (c13) was throttled and returned nothing; the 300-credit cap was reached |
| t8-oncall-alert-review | glm-5 (c11, full) | confirmed |  |
| t8-pm-cache-stampede | glm-5 (c12, full) | confirmed |  |
| t8-pm-cert-expiry-region | glm-5 (c12, full) | confirmed |  |
| t8-rollout-ledger-migration | glm-5 (earlier, after the last edit) | confirmed |  |
| t8-runbook-db-failover | glm-5 (r3, rubric) | confirmed |  |
| t8-tpm-rollout-regions | glm-5 (r3, rubric) | confirmed |  |
| t8-twin-latency-tier-report | glm-5 (c12, full) | confirmed |  |

## Negation-safe cause gates (2026-11-20, CV-FIX worker, owner-approved CV-E2)

- Who: claude (kirocrew-mate-worker, CV-FIX session).
- Why: a gate's `none` word list failed any correct answer that also said what the cause is NOT ("Not the maps-geo
  latency.", "The 2.41.0 deploy is not the cause.", "not caused by the analytics rollup"), and the whole task then
  scored 0. Found by the spot review (reports/spot-review-fixes-2026-11-20.md, addendum on the two held-out tasks);
  the same pattern was then searched across T7, T8, T10, T11 and T12 keys.
- What:
  - `t8-heldout-rollback-decision`: `cause-reused-key` (gate) drops its `none` list, and its first pattern widens from
    `idempoten|request key|payment key` to `idempoten|\bkey(s|ed)?\b`, so a correct cause that says "keys each
    authorisation by cart" passes. `risk-migration-additive` drops `none` ("0042 ... does not block the rollback" failed).
    The alternative answer is rewritten as a different correct answer (other structure, a 14:00 UTC window with
    2.49 % / 0.54 % / 84, other evidence lines, three audiences, a denial of the decoy in the cause).
  - `t8-heldout-incident-handoff`: `cause-recalc-locks` (gate) and `mitigation-flag-off` drop their `none` lists
    ("turn the flag off; do not fail over" missed). `notes/shift-notes-lena.md:8` no longer points at the flags and the
    scheduler ("Ran out of time before the rest of the folder."). The alternative answer is rewritten as a different
    correct answer (three evidence lines, other wording, a denial of the 2.41.0 decoy).
  - `t8-inc-memory-leak`, `t8-inc-queue-backlog`, `t8-pm-cache-stampede` (`cause-summary`, gates),
    `t8-pm-cert-expiry-region` (`root-cause-summary`, gate) and `t8-rollout-ledger-migration`
    (`cause-is-compatibility-null`, weight 2): `none` list dropped. Each reference with a denial of its decoy appended
    scored 0 (97.6 for rollout-ledger) before and 100 after (87.5 for cert-expiry, see below).
- Left, one item each and not a gate (bench/DEBT.md): `t8-heldout-incident-handoff` `item-fix-job`,
  `t8-pm-cert-expiry-region` `summary-does-not-blame-release`, `t8-inc-checkout-latency` `cause-summary`,
  `t8-rollout-ledger-migration` `rota-gap-covered`.
- Gates re-recorded with `dry-run.js --record`: all seven reference 100, stub 0 (7.1 rollout-ledger), lazy 12.5 to 38.1,
  alternative 100. Versions bumped; `handEdited` names this session; recheck in `review.recheck`.
