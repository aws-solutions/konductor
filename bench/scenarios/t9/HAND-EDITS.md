# T9 hand edits

Owner rule (2026-11-19): every change to a task's prompt, fixture, key, checks or rubric by anyone other than the recorded author is listed here and re-checked by a reviewer of another family (`review.recheck`).

## Kept tasks

| task | who | what changed | why | recheck |
| --- | --- | --- | --- | --- |
| t9-impl-combobox | claude, kirocrew-mate-worker (T9 worker) | removed the two `contains` checks (`role="listbox"` in index.html, a function name in src/main.js) from t9-impl-combobox.json | the second review found the function-name check unfair to a correct answer, and the listbox may be built at run time; the fix round was already used | a second glm-5 review of the edited task passed all five review checks; the four-item recheck by qwen3-coder-next passed all four items (review.recheck); dry run reference 100, stub 9.5, lazy 25.4, alt 100 |

## Dropped

- t9-twin-country-data (minimax-m2.5, second family): after one hand fix (the ESM hidden test renamed to .mjs so it could load) and the author's one fix round, the stub scored 32 and the lazy answer 80.5 (gates 20 and 40). Dropped, not hand-fixed further, per the owner rule.
- t9-impl-url-state (qwen3-coder-next, second family after a deepseek-3.2 draft): after the author's one fix round the reference scored 91.8, the stub 58.3 and the lazy answer 41.8 (gates 95, 20, 40). Dropped.
- t9-test-form-validator (qwen3-coder-next): the first draft asked for an ES-module repository that the shared CommonJS mutant runner cannot load (a T9 prompt bug, fixed: CommonJS stack); the CommonJS re-author scored reference 28.6, and after its fix round (cut at 90 tool calls) the reference killed 0 of 10 mutants. Dropped.

## Non-Claude recheck (D-108, 2026-11-20, mate hand-edit recheck worker)

Every Claude hand edit above was checked again. Free first: the free gates (reference, empty, lazy, alternative) and
two scans (rubric anchors and hidden-test names found only in the reference, not in the request or fixture). Then a
non-Claude model ran the four-item checklist ("full": request, fixture, hidden key and rubric; "rubric": the rubric
edits, on top of the earlier non-Claude check of the request, fixture and key). Verdicts are in each task's
`review.recheck`; calls and credits in reports/hand-edit-recheck-2026-11-20.md.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t9-impl-combobox | qwen3-coder-next (earlier, after the last edit) | confirmed |  |

## Rubric anchors, v2 (2026-11-21, mate debt worker, DEBT D-117)

`t9-impl-cart-summary` (`copy`), `t9-impl-combobox` (`voice`) and `t9-review-checkout-ui` (`actionable-review`) each
had one judged rubric item with no Fail / Partial / Pass anchor. Each now has the three anchors, written from the
task's own request (what a shopper or a registrant reads). No check, key, fixture or answer changed, so the free gates
are unchanged. Non-Claude recheck of the anchors: pending (`handEdited.version` 2).

## t9-accessibility-performance-nfr v2 (2026-11-21, mate recheck worker, claude)

The first non-Claude recheck (gpt-5.6-luna, round 6 call L8) failed key-matches-fixture and solvable-from-fixture.
The check that counts tests wants 35, but the fixture has 31 and the request only said "add tests". The request now
says "at least four new ones". Expert items `cap-tradeoff` and `limits` required details only the reference had:
focus staying on Show more, a virtual list or pager as the alternatives, and no test on a mid-range phone. Each now
keeps its core point and gives those details as examples. Checks, hidden tests, fixture and answers are unchanged, so
the free gates are unchanged (100 / 3.6 / 21.4 / 100). Version 1 to 2. One writer-family fix; a second gpt-5.6-luna
recheck follows.

Second recheck (gpt-5.6-luna, L9, v2): no-method-or-decoy and fixture-lists-no-answer pass. key-matches-fixture and
solvable-from-fixture fail on a separate defect. `hidden/browser.test.js` "status filter is a radio group" finds the
four options with `getByRole('radio')`. The fixture's status filter is plain `div` chips, and the request asks only
for keyboard use, arrow keys and spoken labels. So a correct native select or listbox fails that test. Not fixed
here: the writer family has had its one fix attempt (owner rule). Next step: either the request names the radio
group, or the test also accepts a select or listbox; then one more non-Claude recheck.

## t9-accessibility-performance-nfr v3 (2026-11-21, mate free-items worker, claude; DEBT D-154)

The hidden `browser.test.js` now finds the status filter as any accessible single-choice control the request allows:
a radio group (native or ARIA `role="radio"`), a native `select`, or a single-select `listbox`. One helper,
`statusFilter(page)`, reports the selected choice, whether keyboard focus is on the control, the arrow keys that move
the choice (Left/Right for radios, Up/Down for a select or listbox) and how a keyboard user picks one; every test uses
it, and the page-ready wait accepts any of the three. The bar is the same for each kind: Tab from the search box lands
on the control, arrow keys move the choice and filter the list, the live region updates. The request is unchanged and
still names no control. New correct answer `answers/.../alt-select`: the reference with a native select in place of
the radios. Free gates: reference 100, stub 3.6, lazy 21.4, alt 100, alt-select 100 (the old test failed it at the
page-ready wait). Not run in a browser: a listbox answer. Non-Claude recheck: not ordered (owner).

Recheck of v3 (gpt-5.6-luna, round 6 call L10, 2026-11-21): key-matches-fixture and solvable-from-fixture now pass,
because the radio, select or listbox fix holds. Two other items fail. no-method-or-decoy: the request names the
`createSearch(...)` API and the cancelling `schedule`. fixture-lists-no-answer: `docs/architecture.md:21-22` says to
reuse the existing helpers, and `test/match.test.js` shows the matching rules. Not recorded in `review.recheck` and
not disposed (owner rule: on a second fail, stop). The owner decides whether these are defects.

The independent review of those two L10 fails (claude-fable-5.1, 2026-11-21, `reports/review-t9-accessibility-fable.md`
in the mate workspace) found both to be checklist misreads with no defect. The L10 recheck is now in `review.recheck`
at version 3, with the two items disposed in their notes. D-154 is closed.

## t9-review-checkout-ui v3 (2026-11-22, mate LITE-fix worker, claude; LITE analysis item 3)

The `contains (review scope|what i checked)` check (weight 2) failed all six LITE runs: the prompt never asked for
that section. Dropping the check lifted the lazy answer to 43.4 (over the 40 gate), so the prompt now asks for it
instead: "Open it with a short "Review scope" section saying what you checked." Check, key and fixture unchanged.
Gates: reference 100, stub 5.7, lazy 39.5, alt 100. Non-Claude recheck: pending (`handEdited.version` 3).

## t9-review-checkout-ui v4 (2026-11-22, mate LITE-fix worker 2, owner-assigned fixer gpt-terra; LITE analysis item 12)

One rubric criterion (`actionable-review`) passed in all six LITE runs, so the judged side could not separate runs.
Added `severity-calibration` (weight 2), `real-versus-awkward` (weight 1) and `review-scope` (weight 1, reads the
"Review scope" section the v3 prompt asks for), each with Fail, Partial and Pass anchors. No prompt, check, key or
fixture change; gates stand. A score for the new criteria needs a re-judge (paid, not run). Non-Claude recheck:
pending (`handEdited.version` 4).
The v4 hash also covers the dead-check drop that LITE fixes 8-9 landed in place (53cc33ad) under the same number.

## t9-browser-tab-regression v3 and t9-bug-tabs-focus v2: a hanging agent suite no longer voids the hidden suite (2026-11-27, mate debt pass, claude; DEBT D-281)

The same cause as t8-bug-retry-storm v4 (D-280). An agent's own test that never ends on the original code kept the regress proof running to its 60 s limit, which is also the whole `tests` check limit, so the check read "hidden suite did not parse" and lost every behaviour test that passed. No t9 run has shown it yet.

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t9-browser-tab-regression | 2026-11-27 | `regress-kit/config.json`: cmd `node --test --test-timeout=5000 test/*.test.js` (was without the timeout), `timeoutSec` 20 (was 60) | a hang on the original code is a failing suite, so the proof counts it as caught and every other hidden test still counts |
| t9-bug-tabs-focus | 2026-11-27 | `regress-kit/config.json`: cmd `node --test --test-timeout=5000 test/` (was without the timeout), `timeoutSec` 20 (was 60) | the same |

Test: `bench/scenarios/t9/test/regress-hang.test.js` failed before (0/17 and 0/16, "unparsed: timed out") and passes after. Prompt, key, checks and fixtures unchanged. Free gates unchanged: reference 100, stub 16.8, lazy 16.8, alt 100, alt-hashchange 100, alt-window 100; and reference 100, stub 17.9, lazy 17.9, alt 100. Non-Claude recheck: pending (DEBT D-284).
