# T12: the orchestration core

Before this batch no task targeted the part konductor is built around: the `konductor` agent, the `k-full-sdlc`,
`k-delegate` and `kiro-spec-workflow` SOPs and the `delegation-protocol` skill (task review of 2026-11-20). These
four tasks ask for work where that core should help: a spec a teammate can build from, a feature taken from request
to done, a hand-off a stranger can finish, and a plan that runs work in parallel without collisions. Each is scored on
the outcome (what the documents and code say and do), never on whether a procedure was followed.

| Task | What the agent produces | Targets | Scored by |
| --- | --- | --- | --- |
| `t12-spec-rate-limits` | `.kiro/specs/api-rate-limits/` requirements, design and tasks for per-key API limits | SOP `kiro-spec-workflow`; the three kiro spec skills | block key on the tasks.md JSON block: the agreed rules (per key, plan figures from config, 429 shape, exempt callers, one count across instances), traced tasks in a sound order, the unexplained burst figure as an open question |
| `t12-sdlc-contact-import` | `src/import.js`, its tests, a help page and a feature note | agent `konductor`, SOP `k-full-sdlc` | five hidden behaviour tests (one per agreed rule, all cases of the rule in one test) plus a block key on the feature note's requirements, decisions and test plan |
| `t12-handoff-export-dates` | a hand-off brief for a half-diagnosed bug | SOP `k-delegate`, skill `delegation-protocol` | block key: cause file, reproduction, known facts, the rules the change could break, checkable done criteria, the deadline |
| `t12-parallel-backlog` | a release plan for three people | agent `konductor`, skills `delegation-protocol`, `task-decomposition` | block key: what overlaps in the code (the model's FIELDS list, the configuration file), waves, packages with files and done criteria, the on-hold item left out |

Every key uses `"scoring": "sections"` (a section earns all with nothing missed, half with one item missed, nothing
with more) and most have a gate item; see `bench/scenarios/lib/hidden/block-key.js`.

## Answers the dry run scores

- `answers/<id>/lazy/`: the mechanical half answer (`bench/scenarios/lib/answers.js`); for the SDLC task a
  hand-written half-done importer, since the mechanical one keeps the full code.
- `answers/<id>/alt/`: the mechanical alternative (reworded, reordered), except `t12-parallel-backlog`, whose
  alternative is a hand-written different plan (separate currency packages, another wave split).
- `answers/<id>/shallow/`: a hand-written shallow fake that uses the right words and does none of the work (gate 40).

```
node bench/scenarios/lib/dry-run.js --config bench/scenarios/t12/scenario.config.js [id ...] [--record]
```

## Limits

The tasks were written by hand by a Claude worker (no author model call was approved), so they carry `handEdited` and
`authorship.singleFamily` and wait for a non-Claude recheck (DEBT D-108). No agent has run them yet.
