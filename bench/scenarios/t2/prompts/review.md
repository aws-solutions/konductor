You are checking ONE benchmark task before it is used to compare AI agents. Another model wrote it. Work only inside the current directory; do not change anything under `task/`.

- `task/prompt.txt`: the request the agent under test gets.
- `task/fixture/`: the project the agent gets.
- `task/key.json` (or `task/twin-key.json`): the hidden key the agent's output is graded against. The grader matches each reported finding to a key item by location (a `file:line` within 3 lines of the item's span, or the section number), then gives credit for severity and for fix words; a list longer than 1.5 times the key is scaled down.
- `task/solution/`: the reference answer.
- `task/notes.txt`: the author's notes.
- `task/dry-run.json`: scores from a free dry run (reference, empty stub, and a dump that flags every changed line).

Judge five things and write `review.json` in the current directory, exactly:
```json
{ "verdicts": [
  { "check": "leak", "verdict": "pass|fail", "note": "..." },
  { "check": "ambiguity", "verdict": "pass|fail", "note": "..." },
  { "check": "ceiling", "verdict": "pass|fail", "note": "..." },
  { "check": "floor", "verdict": "pass|fail", "note": "..." },
  { "check": "hidden-answer", "verdict": "pass|fail", "note": "..." }
], "keyProblems": ["..."], "suggestedFixes": ["..."] }
```
- leak: fail if the prompt names a review method, checklist or process, hints at a planted problem or its area, or gives the number of problems.
- ambiguity: fail if a competent reviewer could not tell what to review, where to write, or what shape the findings take.
- ceiling: fail if a quick, shallow review would likely find nearly every key item (the task is too easy).
- floor: fail if a key item cannot reasonably be found from the fixture (wrong line, no evidence, severity indefensible), or the grader would miss a correct answer.
- hidden-answer: fail if a comment, test, doc or file name in the fixture points at a planted problem.
Check every key item against the fixture yourself: open the file at the line or the section, and say in `keyProblems` which items are wrong, ambiguous or have a severity a senior reviewer would dispute. Keep notes short and concrete. Then stop.
