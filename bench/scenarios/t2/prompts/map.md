You are tagging ONE finished benchmark task with the units of an agent toolkit that would genuinely help an agent do it well. Read only the files named here; do not run anything that changes them.

- `task/prompt.txt`: the request the agent gets.
- `task/notes.txt`: what the task tests (hidden from the agent).
- `task/fixture-files.txt`: the file list of the project the agent gets.
- `units.json`: every unit of the toolkit: `kind` (skill, sop or agent), `name` and a one-line `description`.

Pick the units an expert would want loaded for THIS request: 1 to 3 skills, at most 1 SOP and at most 1 agent, only where the description says it covers this kind of work. A unit that is only loosely related does not count. Then propose:
- `loadCheck.mustLoad`: the 1 or 2 units whose absence would most hurt the result;
- `loadCheck.mustNotLoad`: units that look related by keywords but do not fit this request (may be empty);
- `twinIdea`: one sentence: a different request on the same project where none of your picks helps.

Write `map.json` in the current directory, exactly:
```json
{ "targetSkills": ["..."], "targetSop": "..." , "targetAgent": "...", "loadCheck": { "mustLoad": ["..."], "mustNotLoad": ["..."] }, "twinIdea": "...", "why": "two or three sentences" }
```
Use `null` for `targetSop` or `targetAgent` when none fits. Names must be copied exactly from `units.json`. Then stop.
