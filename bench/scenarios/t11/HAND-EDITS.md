# T11 hand edits

Owner rule (2026-11-19): every change by anyone other than the recorded author to a task's prompt, fixture, key, checks
or rubric is logged here, and the task carries `handEdited`. Each edited task is re-checked by a non-Claude reviewer
(`review.recheck`).

| task | who | what changed | why |
| --- | --- | --- | --- |
| t11-media-returns-whiteboard | claude (kirocrew-mate-worker, T11 worker session) | `authoring/t11-media-returns-whiteboard/gen/returns-whiteboard.html` (one CSS rule: arrows with no colour class get the blue ink colour) and the PNG rendered from it, `fixtures/t11-media-returns-whiteboard/docs/design/returns-whiteboard.png` | After the author's fix round the scan, openCase and archive arrows had no stroke colour, so only their arrowheads showed and the archive source was unreadable. No label, value, state or test changed. |
## Dropped

| task | why |
| --- | --- |
