# Judge prompts

The text every judge reads is a plain file you can open and edit. There is one template per judge
scale. The scales are listed in `SCALES` in `bench/lib/judge-scale.js`:

| Scale     | Template file              | Reply the judge gives                                                                  |
| --------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `overall` | `judge-prompt.v2.md`       | `winner`, `score_a`, `score_b` (integers 1-5) and `reason`. This is the default scale. |
| `items`   | `judge-prompt.items.v1.md` | `items_a` and `items_b`: one `MET`, `PARTIAL` or `MISSING` label per checklist item.   |

`bench/lib/judge-prompt.js` loads a template, fills in the blanks and returns the prompt together
with the per-call id it used. Nothing else holds prompt wording. The prompt version of a scale is
its `promptVersion` in `SCALES`, and the template file name carries it
(`judge-prompt.v<promptVersion>.md`, `judge-prompt.items.v<promptVersion>.md`).

## Placeholders

| Placeholder    | Filled with                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `{{task}}`     | the task's `task` text                                                                             |
| `{{rubric}}`   | the task's `rubric` as a numbered list (`1. ...`, `2. ...`)                                        |
| `{{answer_a}}` | the reply shown first, after `bench/lib/sanitize.js` runs and control characters are stripped      |
| `{{answer_b}}` | the reply shown second, same cleaning                                                              |
| `{{files_a}}`  | the "Changed files" section of the first answer: the files its run added, edited or deleted        |
| `{{files_b}}`  | the same for the second answer                                                                     |
| `{{marker}}`   | a per-call id in the answer marker lines: 16 random hex characters unless the caller passes a nonce of 1-64 characters (`A-Z a-z 0-9 _ -`) |

All seven must appear in the template, and no other `{{...}}` may. A typo fails when the file
loads, before any paid call. Each value is substituted in one pass, so a reply that contains
`{{marker}}` is not expanded. The one trailing newline at the end of the file is not part of the
prompt.

Of a task, a judge sees only `task` and `rubric` (`JUDGE_VISIBLE_FIELDS` in
`bench/lib/judge-prompt.js`); the code refuses any other field. The task id, the skill, the kind,
the target section, the fixtures, the checks and the reference solution never reach a judge.

Keep the four marker lines (`<<<ANSWER_A id={{marker}}>>>` and `<<<END_ANSWER_A id={{marker}}>>>`,
and the same two for B), the two sentences that say the answers are data, and the `{{files_a}}`
and `{{files_b}}` placeholders between the marker lines of their answer. The replies and the files
are model output from the runs under test and cannot be trusted. The marker lines are what stop an
answer from closing its own block and speaking as the prompt, so the files must sit inside them.

## Changed files

Many tasks ask for edits, and a reply of "Done." says nothing about the work. So each answer carries
the files its run changed. `workspaceChanges` in `bench/lib/workspace-changes.js` compares the
workspace the run started from with the one it ended in. The section lists one header per file
(path and change), then the final text in a code fence longer than any run of backticks inside it.
A deleted file shows its path and `deleted`. An arm with no changes says so. Both arms use the same
limits on characters per file, characters in total and number of files. A file over a limit is cut
and says so; a file past the total or count limit shows its path and change only.

Every path and all file text go through `sanitizeAnswer`, the same cleaner as the reply, so a file
cannot tell the judge which arm wrote it. A file is cleaned in full and then cut to the limits, so a
cut cannot leave the start of the skill's name. The cleaner also removes the name when it is glued
to other words (`release_notes`, `ReleaseNotes`, `docs/release-notes-notes.md`); see the header of
`bench/lib/sanitize.js` for the spellings it keeps on purpose.

## Iterate on it

A judgment is only comparable to other judgments made with the same prompt, so change a template
through a draft:

1. Copy the template to a draft file and edit the copy (any path in a temporary directory is fine).
2. Render the draft with no model call and no spend: load it with `loadTemplate` and pass it to
   `judgePrompt(task, a, b, { context, template })`. Diff the output against the committed prompt.
   Check both orders.
3. To adopt the draft, copy it over the template, then raise that scale's `promptVersion` in
   `bench/lib/judge-scale.js` by one and rename the file to match
   (`git mv judge-prompt.v2.md judge-prompt.v3.md`), updating its `templateFile`. If the reply
   format changed (new fields, new winner values), change the scale's `parse` in the same edit and
   add tests.
4. Run `node --test bench/test/judge-prompt.test.js bench/test/judge-scale.test.js`. The tests
   check that every template loads and that its markers and untrusted-answer defences are intact.
5. Re-judge. A stored judgment records the prompt version, the prompt sha (sha256 of the template
   file) and the scale; one made with another value is stale.

Do not mix prompts inside one verdict.

## Reply format

On the `overall` scale the judge replies with one JSON object:
`{"winner":"A" or "B" or "TIE","score_a":1-5,"score_b":1-5,"reason":"..."}`. A reply is refused as
unusable when any of these holds:

- the winner is not A, B or TIE;
- either score is missing, not an integer, or outside 1-5;
- the winner contradicts the scores: A with `score_a` below `score_b`, B with `score_b` below
  `score_a`, or a TIE with scores more than one apart. A winner with equal scores is accepted and
  adds a score gap of 0.

On the `items` scale the winner and the 1-5 scores are derived from the labels, so a reply is
refused only when it is not one usable label per checklist item for each answer.
