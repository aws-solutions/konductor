# T5: QA and testing tasks

Thirteen tasks (12 real, 1 near-miss twin) for the testing phase. Layout, as for the other batches: `<id>.json` (task, schema v3), `fixtures/<id>/` (the repository the agent starts in), `hidden/<id>/` (the hidden scorer, copied over a scratch copy of the workspace), `solutions/<id>/` (the reference overlay), `briefs/<id>.json` (the authoring brief), `AUTHORING-LOG.md` (every model call and its credits).

## How a task is scored

| Kind | Tasks | Hidden part |
| --- | --- | --- |
| Mutants killed | cart-weak-tests, ledger-gaps, parser-gaps, scheduler-gaps, security-tests, flaky-fix, dev-legacy-characterize, fe-widget-logic-tests | `mutation-kit/` (`mutants.json`, `pristine/`, `mutants/<id>/`) and `mutation.test.js`. One hidden test per mutant: it passes when the agent's tests pass on the real code and fail on the mutant. The share of passing tests is the share of mutants killed. Seven kits (all but flaky-fix) also hold a safe refactor (`refactors/r1/`: same behaviour, new internals) and a suite-size budget (`maxTests`, stated in the prompt): one test that the agent's suite passes the refactor, one that it stays within the budget, and a kill counts only when the suite also passes the refactor, so a suite that pins internals or source text earns nothing. `lib/mutants.js` is the runner (per-test timeout, process-group kill, real source restored before every run). |
| Findings key | checkout-strategy, sync-strategy, suite-audit | `findings.test.js` and `findings-kit/` (the key and `bench/runner/lib/findings-key.js`): two tests per key item plus one for list length. The strategy tasks also carry an `expertKey` for the judges (rubric share only). |
| Scripted user | acceptance-criteria | `acceptance.test.js`: two tests per hidden fact the scripted user holds. |
| Twin | cart-twin-config | Ordinary hidden tests (`hidden/*.test.js`); same fixture as cart-weak-tests, a different ask. |

`flaky-fix` also has `stability.test.js` and `chaos/preload.js`: the agent's suite is run under a shifted clock, another time zone, shared state, a fixed random draw and slowed timers.

## Tools

All through the shared tools with `--config bench/scenarios/t5/scenario.config.js` (`bench/scenarios/lib/README.md`):

- `lib/prompt.js <id>`: the author prompt from `prompts/` and the brief.
- `lib/stage.js normalize|map|review|assemble <id>`: after the author call (needs `T5_AUTH`).
- `lib/dry-run.js [id ...]`: free check; the reference scores at least 95, the untouched fixture 20 or less, three repeats agree, the lazy answer 40 or less and the alternative 80 or more (`answers/<id>/`).
- `lib/build-hidden.js` (this batch's): adds the shared scoring kit (`mutants.js`, `mutation.test.js`, `findings.test.js`, `findings-key.cjs` from `bench/scenarios/lib/hidden`) to an author's hidden dir; committed hidden dirs name them in `.bench-lib.json`. `lib/mutants.test.js` tests the mutant runner.

A task that targets one of the three SOPs that need the user's yes (`k-e2e-test-generation`, `k-light-ui-testing`, `k-test-coverage-review`) gets one sentence at the end of its prompt: the scope is confirmed and committing on the branch is fine (`stage.js`, `SOP_NEEDS_YES`).

Fixtures have no git history (a nested `.git` cannot be committed; see DEBT D-59).
