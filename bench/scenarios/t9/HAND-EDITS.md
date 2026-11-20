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
