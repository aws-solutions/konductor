# Glossary

Terms used in fuse-flow workflows and workstreams. "Maps to" names the same concept in vanilla
Konductor and in AI-DLC, where one exists. Terms use the established name from either system when
it fits; otherwise they use the clearest ordinary engineering term.

## Terms

| Term | Meaning | Maps to |
|---|---|---|
| `workflow` | A YAML file that defines a process as an ordered list of steps. | Konductor: "workflow", used loosely in prose for the SDLC flow or a SOP. AI-DLC: no single file; the nearest is a scope plus its compiled stage graph. |
| `step` | One unit of work, with a required `instruction`, optional artifact inputs and outputs, and gates. Steps run one at a time in file order. | Konductor: "Step N" in a SOP; `phases.<id>` in the state file. AI-DLC: stage. AI-DLC's "step" is prose inside a stage, one level lower. |
| `instruction` | The sentence or paragraph that states what a step must achieve. It opens the engine's `STEP` block. | Konductor: a SOP step's prose. AI-DLC: a stage's Markdown body. |
| `phase` | An informational label that groups steps in the viewer. It does not affect execution. | Konductor: none; its "phase" means a single step. AI-DLC: phase. |
| `workstream` | One running instance of a workflow, named by a slug. It can span many agent sessions. | Konductor: session, or run. AI-DLC: intent; AI-DLC's "workflow" is the lifecycle of one intent. |
| artifact | A logical work product with an identifier and project-relative path. The path may be a file or directory and may contain `{slug}`. | Konductor: artifact, or "Expected Output". AI-DLC: artifact. |
| `consumes` | Artifact identifiers from earlier steps that the step reads. The engine prints each as `READ` and reports a missing input without refusing the step. | Konductor: none. AI-DLC: `consumes`. |
| `produces` | Artifact mappings the step is expected to create. Completion requires each path or a justified `--not-produced` report. | Konductor: no field; described in prose. AI-DLC: `produces`, which lists logical names rather than mappings with paths. |
| `optional_produces` | Artifact mappings the step may create. Existing paths are recorded; missing paths need no reason. | Konductor: none. AI-DLC: `optional_produces`. |
| `updates` | Artifact mappings for existing work the step may change, such as code. Every one is accounted for with `--updated` files or an `--unchanged` reason. | Konductor: none. AI-DLC: none. |
| `condition` | The single optional predicate that decides whether a step runs. It uses an `owner-action`, `check`, `script`, or `agent` mapping. A step without one is mandatory. | Konductor: optional behavior in SOP prose. AI-DLC: conditional stage behavior in prose. |
| `gate` | Something that must hold before a step completes. The kinds are `owner-action`, `check`, `script`, and `agent`; they run as mechanical gates, agent review, then owner action. | Konductor: quality gate. AI-DLC: gate. |
| `owner-action` | A gate or condition that asks the owner to do or decide what its text says. As a gate it moves finished work to `AWAITING_OWNER`; as a condition it is answered before work starts. | Konductor: an approval pause described in prose. AI-DLC: the `AwaitingApproval` stage state, which is narrower. |
| `check` | A lower-case kind of mechanical check, such as `default`, that policy binds to a project command or to `none`. | Konductor: checks described in prose. AI-DLC: a deterministic sensor. |
| `script` | A literal shell command used as a mechanical gate or condition. It runs from the repository root. | Konductor: a programmatic check in SOP prose. AI-DLC: a deterministic sensor. |
| `agent` gate | An independent review described by text, optionally with `max_rounds` and a review `guide`. The maker classifies findings and counts rounds. | Konductor: review and revision loops. AI-DLC: an advisory review stage. |
| `max_rounds` | The number of review rounds ending with a required fix allowed before the maker reports the step blocked. The default is 2, and the owner may grant more. | Konductor: round, one review and revision iteration. AI-DLC: `reviewer_max_iterations`. |
| `route_back_to` | Suggested earlier steps for the owner's `--back-to` decision when a gate cannot pass. It is not automatic control flow. | Konductor: "route a fix back to the phase and skill that produced the artifact", in prose. AI-DLC: jump back, which resets later stages and keeps files. |
| artifact library | Artifact definitions found by identifier under `library/artifacts/<id>/`. Project entries replace user entries, which replace package entries. | Konductor: output templates and procedures, stored separately. AI-DLC: templates plus team knowledge. |
| `guide.md` | The artifact library's instructions for producing one kind of artifact. | Konductor: usually a skill or part of a SOP. AI-DLC: stage instructions or knowledge. |
| `template.<ext>` | Optional artifact structure. The engine points to it but does not copy it. | Konductor: output template. AI-DLC: template. |
| `review.md` | Optional artifact-specific review criteria used by an `agent` gate. | Konductor: review procedure. AI-DLC: review-class guidance. |
| policy overrides | Mechanical project configuration in `policy-overrides.yml` or `policy-overrides.local.yml`: check bindings, review settings, and artifact paths. | Konductor: parts of `HOUSE-RULES.md` and project configuration. AI-DLC: team configuration. |
| hand-over block | The final five labelled lines in every hand-back to the owner: `SUMMARY`, `STATUS`, `PRODUCED`, `VERIFICATION`, and `NEXT STEP`. | Konductor: handoff or completion receipt in prose. AI-DLC: stage transition summary. |
| `skip_reason` | The recorded reason a step became `SKIPPED`, including a false condition or owner-directed jump. | Konductor: `skip_reason`, required for a `SKIPPED` step. |

## Step states

| Term | Meaning | Maps to |
|---|---|---|
| `PENDING` | The step has not been handed out. | Konductor: `PENDING`. |
| `IN_PROGRESS` | The engine handed out the step and the agent is working on it. | Konductor: `IN_PROGRESS`. |
| `AWAITING_OWNER` | The work passed earlier gates and an `owner-action` gate waits. | Konductor: an approval pause in prose. AI-DLC: `AwaitingApproval`, for approvals only. |
| `BLOCKED` | The planned path broke down, such as at the review cap or because a mechanical check cannot run for an external reason. The owner decides. | Konductor: `BLOCKED`. |
| `COMPLETED` | The step passed its gates or the owner approved it. | Konductor: `COMPLETED`. AI-DLC: `Completed`. |
| `SKIPPED` | The step did not run; `skip_reason` records why. | Konductor: `SKIPPED`. |

## Hand-over statuses

These values describe why control is returning to the owner. They are message statuses, not extra
step states.

| Term | Meaning | Step state |
|---|---|---|
| `awaiting owner action` | The step's work is done and an owner action waits. | `AWAITING_OWNER` |
| `blocked` | The planned path broke down and the owner must choose how to proceed. | `BLOCKED` |
| `needs input` | The agent needs an owner answer before continuing the current step. | `IN_PROGRESS` |
| `paused` | The agent needs nothing except a request to resume the current step. | `IN_PROGRESS` |
| `workflow complete` | Every step is completed or skipped. | No current step. |

## Artifact statuses

| Term | Meaning | Maps to |
|---|---|---|
| `draft` | The artifact is recorded but its owner-action gate has not passed, or its step was reopened. | Konductor: none. AI-DLC: none. |
| `approved` | The artifact's step completed, with or without an owner gate. | Konductor: none. AI-DLC: none. |
| `superseded` | A later artifact replaced this one. The state supports the value, but replacement behavior is deferred. | Konductor: none. AI-DLC: none. |

## Override layers

From general to specific: engine and package defaults; user policy at
`~/.konductor/policy-overrides.yml`; the workflow and its gates; project policy at
`.konductor/policy-overrides.yml`; project-local policy at
`.konductor/policy-overrides.local.yml`; workstream state; then the owner's recorded decision for
approval, added rounds, or a jump.

The artifact library lookup is project, user, then package. The first existing artifact folder is
used as a unit.

## Reserved terms

These names are set aside for concepts fuse-flow does not implement yet.

| Term | Meaning | Maps to |
|---|---|---|
| `revising` | An approved artifact is being reworked after a later step loops back to it. | Konductor: "revise and re-present". AI-DLC: the `Revising` stage state. |
| `for_each` | Repeat a step once per item. fuse-flow currently treats all items as one workstream or lets the owner split them into workstreams. | Konductor: per-feature steps described in prose. AI-DLC: `for_each`, which supports `unit-of-work`. |
| `if`, `switch`, `when`, `then` | Choose a path through the workflow rather than merely skipping one conditional step. | Konductor: none. AI-DLC: none; `when` is parsed but not evaluated. Taken from the Open Workflow Specification. |
| `fork`, `branches` | Run workflow branches in parallel. | Konductor: none. AI-DLC: none. Taken from the Open Workflow Specification. |
| `parameters` | Values supplied when a workstream starts and used by conditions or paths. | Konductor: none. AI-DLC: configuration values. |
| gate library entry | A reusable gate under `library/gates/`. The directory is reserved, but the entry format and workflow reference are deferred. | Konductor: reusable quality-gate prose. AI-DLC: reusable sensor or review configuration. |
