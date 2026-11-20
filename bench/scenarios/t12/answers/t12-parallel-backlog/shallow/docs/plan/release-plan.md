# Release plan

Everything can run in parallel with three people. We split the backlog evenly.

```json
{
  "waves": [["A1", "A2", "A3"], ["A4", "A5", "A6"], ["A7"]],
  "packages": [
    { "id": "P1", "items": ["A1", "A2", "A3"], "files": ["src/"], "doneWhen": "done" },
    { "id": "P2", "items": ["A4", "A5", "A6"], "files": ["src/"], "doneWhen": "done" },
    { "id": "P3", "items": ["A7"], "files": ["src/"], "doneWhen": "done" }
  ],
  "dependencies": [{ "before": "A1", "after": "A2", "reason": "A2 needs A1" }],
  "conflicts": [],
  "notScheduled": [],
  "mergeOrder": ["P1", "P2", "P3"]
}
```
