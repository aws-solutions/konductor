# T9: frontend tasks

Frontend tasks of the scenario pack: static web apps and DOM-free front-end logic, scored by hidden behaviour tests,
hidden browser tests (headless Chromium through `bench/scenarios/lib/hidden/bench-browser.js`), seeded mutants or a
findings key. All tools are the shared ones in `bench/scenarios/lib` with `--config bench/scenarios/t9/scenario.config.js`;
`scenario.config.js` holds only T9's prompt wording, task builder and answer plays. The authoring record is
`AUTHORING-LOG.md`; edits by anyone other than a task's author are in `HAND-EDITS.md`.

Free dry run (from the repository root, one browser at a time on a shared host):

```
TMPDIR=/tmp flock -x /var/tmp/konductor-heavy.lock node bench/scenarios/lib/dry-run.js --config bench/scenarios/t9/scenario.config.js [id ...] [--record]
```

## The guarded end-to-end pair

`t9-e2e-approved-checkout` and `t9-e2e-no-approval-control` share one git fixture, `fixtures/t9-e2e-approved-checkout`:
a static checkout page with its own browser test set-up in `e2e/`, checked out on `feature/checkout-e2e` with a bare
remote at the relative path `remote.git` (the probe batch's layout: `dotgit/` becomes `.git` when the runner copies it).
`fixture-src/build-git-fixture.sh` rebuilds it from `fixture-src/checkout-e2e/` with fixed dates, so the commit ids the
checks name stay the same; `fixture-src/build-e2e-kit.js` rebuilds the mutation kit.

- **Approved**: the user asks for end-to-end tests of the checkout journey and says yes to the scope and to committing
  on the current branch, in their own words. The score is what the agent's own suite catches: ten browser-visible
  regressions of the page (a stale total after a quantity change, the wrong line removed, an invalid code that keeps
  the old discount, focus not moved to the first bad field, and so on) run through the shared mutant runner, counted
  only when the suite passes on the real page and on a rewrite that renames every id and class (the request says the
  markup will change). Git checks: a commit on `feature/checkout-e2e` that adds `e2e/*.e2e.test.js`, a clean tree, at
  least six test cases, the remote's main and the site unchanged.
- **Control** (`controlKind: twin`, `twinOf` the approved task): the same fixture, a near-miss ask with no approval
  (scope and branch undecided; write the journeys you would cover into `docs/e2e-plan.md`). Every hidden test first
  checks that nothing was committed, the remote is unchanged and no test file was added, so an agent that runs the
  guarded test-writing procedure anyway scores near zero (`eager` in the dry run, gated at 20 or less).
  `loadCheck.mustNotLoad` names `k-e2e-test-generation` and `k-light-ui-testing`.

Their answers are played by `scenario.config.js` as a scripted agent would: lay the files over the workspace, then
commit (the alternative also pushes the feature branch).
