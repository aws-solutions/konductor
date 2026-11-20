# T9 hand edits

Owner rule (2026-11-19): every change to a task's prompt, fixture, key, checks or rubric by anyone other than the recorded author is listed here and re-checked by a reviewer of another family (`review.recheck`).

## Kept tasks

| task | who | what changed | why | recheck |
| --- | --- | --- | --- | --- |
| t9-twin-country-data | claude, kirocrew-mate-worker (T9 worker) | renamed hidden/hidden-twin.test.js to hidden-twin.test.mjs and changed the tests check command to match; gave every check a weight | the author's ESM test could not load in the CommonJS repository, so no answer could score; the rest went to the author's fix round | the qwen3-coder-next review of the fixed task |
| t9-impl-combobox | claude, kirocrew-mate-worker (T9 worker) | removed the two `contains` checks (`role="listbox"` in index.html, a function name in src/main.js) from t9-impl-combobox.json | the second review found the function-name check unfair to a correct answer, and the listbox may be built at run time; the fix round was already used | a second glm-5 review of the edited task passed all five review checks; the four-item recheck by qwen3-coder-next is pending; dry run reference 100, stub 9.5, lazy 25.4, alt 100 |

## Dropped

None yet.
