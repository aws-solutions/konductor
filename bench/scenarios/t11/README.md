# T11: picking up work, merging, media and Word inputs, wide changes, repo guides

Batch T11 of the scenario pack (plan "Scenario program v3", section 9): tasks where a developer needs to pick up a
half-done branch, merge two branches that touch the same code, read a picture or a Word document, change a whole
codebase, or document an unfamiliar repository. Every fixture is original. Media and Word inputs are made by a
generator kept under `authoring/<id>/gen/` (HTML rendered to PNG with headless Chromium; a .docx written with Python's
`zipfile`), so they can be made again; their content is original (`authorship.source` names the public idea, if any).

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the folder the agent starts in; `dotgit/` is its own git repository (renamed to `.git` when copied) |
| `hidden/<id>/` | hidden tests, laid over the folder root; `.bench-lib.json` names shared helpers (block key) |
| `solutions/<id>/` | the reference answer; a folder holding `APPLY.sh` does git work (`lib/modes.js`) |
| `answers/<id>/{lazy,alt}/` | the shallow and the second correct answer, written by the author |
| `authoring/<id>/gen/` | the generators of the fixture (repository history, PNG, .docx) |
| `briefs/<id>.json` | the brief the author got |
| `prompts/` | the author, two-step and review prompts |
| `lib/` | T11's answer modes (APPLY.sh), hidden kit builder, author self-check, PNG renderer |
| `AUTHORING-LOG.md`, `HAND-EDITS.md` | every model call with its credits; every hand edit |

## Commands (free)

```
node bench/scenarios/lib/dry-run.js --config bench/scenarios/t11/scenario.config.js [id ...] [--record]
node bench/scenarios/lib/stage.js --config bench/scenarios/t11/scenario.config.js assemble <id>
```

The second author family writes in two calls (`twoStep` in the brief): step 1 the fixture and the request, step 2,
from the fixture and step 1's `design.md` only, the hidden checks and the answers.

## Not in this batch

A task where a second, fresh session must use what a first session learned needs the runner to start a new session
in the same workspace and HOME. The runner's multi-turn mode resumes the same conversation (`--resume`), and only
when the agent asked a question, so it cannot test memory across sessions. That task waits for runner support.

`t11-wide-settings-migration` (a change across 60 or more files) was dropped after three second-family tries; its brief
stays in `briefs/` and the reasons are in `HAND-EDITS.md` under Dropped.
