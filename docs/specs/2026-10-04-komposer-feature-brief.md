# Komposer: feature brief

Date: 2026-10-04. Audience: Claude Design. Owner: Thiemo Belmega.

This brief says **what** a user must be able to do with Komposer. **How** it looks and feels is for
design to decide. Where the brief names a representation, such as an arrow or a pill, it is an
example, not a requirement. The section "Decided by design" lists the choices we leave open on
purpose.

This brief replaces the data model of the workflow editor handoff of 2026-09-30. That handoff
predates a redesign of the workflow format: skills on steps, `gate: owner`, `depends_on`, `on_fail`
and `max_fix_cycles` no longer exist. Its visual language and its product rules still stand
unless this brief says otherwise.

## Background

**fuse-flow** keeps an AI coding agent on a defined process. It has two parts:

- A **workflow** is a YAML file that describes the process: an ordered list of steps, the
  documents ("artifacts") each step reads and writes, and the gates that end each step.
- The **engine** is a command-line tool the agent runs. It reads the workflow and the progress of
  one piece of work (a "workstream"), and tells the agent the next step. It refuses to move on
  while a required artifact is missing or a check fails, and it hands decisions to the person who
  owns the work (the "owner") where the workflow asks for one.

People edit workflows in three ways: directly in the YAML in their code editor, by asking an agent
in a conversation, and in Komposer. All three edit the same files. **The files on disk are the
only source of truth**; Komposer is a view and an editor over them, and has no data of its own
except unsaved edits.

**Komposer today** is a read-only viewer. It lists the workflows that ship with fuse-flow, grouped
by folder, draws the selected workflow's steps as a vertical flow with artifact chips, edges for
the artifacts a step reads, phase labels and gate kinds, and shows the raw YAML in a dialog.

**Who uses it:** engineers who author and maintain workflows for themselves or their team. They
know YAML and git, and they read the YAML. Komposer is a power-user tool.

## Product rules

These carry over from the earlier handoff and remain binding:

- No marketing or explanatory copy, taglines or introductions. Labels, values and controls only.
  Helper text only where it prevents an error.
- One screen.
- The interface does not label workflows as "shipped", "read-only" or "project". Where a workflow
  lives is information (see "Workflow locations"), not a permission.
- Edits are kept in a working copy until the user saves. Saving offers two choices: update the
  original file, or save under a new name. There is no fork button.
- Saving keeps the file's comments, key order and formatting where the user did not change them.
  People also edit these files by hand.

## The workflow format

Design needs to know every field, because the editor must be able to set all of them and the
visualization must be able to show all of them. Fields marked "informational" do not change what
the engine does.

### Workflow

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Always `1`. Not something the user edits. |
| `name` | yes | The workflow's name, by which it is started. Matches the file name. |
| `description` | no | One or two sentences an agent shows the owner when offering workflows. |
| `steps` | yes | One or more steps, run one at a time in list order. |

### Step

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lower-case letters, digits and hyphens; unique in the workflow. Other fields refer to steps by id. |
| `instruction` | yes | What the step must achieve, in prose; often a paragraph, sometimes several. The first thing the agent reads. |
| `title` | no | Informational. A short human name. |
| `description` | no | Informational. A note for readers. |
| `phase` | no | Informational. A label that groups consecutive steps, such as "Design" or "Build". |
| `condition` | no | Makes the step optional (see "Conditions"). Without one, the step is mandatory. |
| `consumes` | no | Artifact ids, produced by earlier steps, that this step reads. |
| `produces` | no | Artifacts this step must write. |
| `optional_produces` | no | Artifacts this step may write. |
| `updates` | no | Artifacts this step changes rather than creates, usually the code. |
| `gates` | no | What must happen before the step counts as done (see "Gates"). |

### Artifact mapping

Used in `produces`, `optional_produces` and `updates`.

| Field | Required | Meaning |
|---|---|---|
| `artifact` | yes | The artifact's id. Also the key into the library. |
| `path` | yes | Where the file lives, relative to the project. Usually contains `{slug}`, which the engine replaces with the workstream's name, so two pieces of work do not overwrite each other's files. `.` means the whole repository. |
| `description` | no | Informational. |

### Gates

A step has zero or more gates. There are four kinds. Each gate has a text, and some kinds have
more fields:

| Kind | Its text | Extra fields | Meaning |
|---|---|---|---|
| `owner-action` | what the owner does, such as "approve the plan" | | The step waits for the owner. |
| `check` | a check kind: one lower-case word, usually `default` | | Runs the command the project has bound to that kind, such as its test command. |
| `script` | a shell command | | Runs a literal command that must succeed. |
| `agent` | what to review | `max_rounds` (whole number, at least 1, default 2); `guide` (path to a review guide) | The agent obtains an independent review and fixes what it finds, at most `max_rounds` times before the owner decides. |

Every gate may also have:

- `route_back_to`: one or more step ids, the same step or earlier ones. Informational: it tells the
  owner where the work can be sent back when this gate fails. It does not change the flow by
  itself.
- `description`: informational.

The engine always runs a step's gates in a fixed order, whatever their order in the file:
`check` and `script` first, then `agent`, then `owner-action`.

### Conditions

A condition is written like one gate, of any of the four kinds, with only its text:

- `script` or `check`: the engine runs it when the step is reached. Success means the step runs;
  failure means it is skipped.
- `agent`: the agent judges whether the text applies, such as "the change touches an unfamiliar
  area".
- `owner-action`: the agent asks the owner.

### Validation rules

The editor must prevent or flag every state the engine would reject:

- Step ids are unique and match the id pattern.
- Every `consumes` id is produced (by `produces` or `optional_produces`) by an earlier step.
- Every `route_back_to` target is the same step or an earlier one.
- A `check` text is a single lower-case word.
- `max_rounds` and `guide` appear only on `agent` gates.
- A condition has only its text: no `route_back_to`, `max_rounds` or `guide`.
- A step has at most one condition.
- `instruction` is never empty.

## The artifact library

We have settled on a library of **artifacts only**. A shared guide always belongs to an artifact;
there is no library of steps, gates or skills.

### What an entry is

A library entry is a folder named by the artifact id, with up to three files:

- `guide.md`: how to produce this kind of document. Usually a few pages of Markdown.
- `template.<ext>`: an optional skeleton for the document, such as `template.md`.
- `review.md`: an optional guide for reviewing it, used by `agent` gates.

When a step produces an artifact that has a library entry, the agent follows that entry's guide
and template. **Adding a library artifact to a step therefore reuses its guide.** An artifact id
with no library entry is allowed too: then the step's instruction is the whole procedure.

### Where entries live

Entries live at three levels, and the most specific one wins as a whole:

1. the project's library;
2. the user's personal library;
3. the library that ships with fuse-flow.

So a project can replace a shipped guide with its own under the same id. The entries shipped
today are `code`, `design`, `design-spec`, `doc-accuracy`, `feature-split`, `implementation-plan`,
`requirements-summary`, `spec-index`, `task-doc`, `test-coverage` and `user-stories`.

### What the user can do

- Browse and search the library: each entry's id, which of guide, template and review guide it
  has, at which level it lives, and whether a more specific level hides another entry with the
  same id.
- Read an entry's guide, template and review guide without leaving Komposer.
- See which workflows and steps use an entry.
- Add an entry to a step as something the step produces, may produce, or updates, and set its
  path, suggested from the id with `{slug}`.
- Add an artifact that has no library entry, by typing a new id.
- See, on every artifact in a workflow, whether it has a library entry, so a missing guide stands
  out.

Writing and editing guides is out of scope for now: people do that in their code editor.

## The editor

The user must be able to change everything in a workflow file without opening the YAML.

### Workflows

- Create a new workflow, choosing where it lives.
- Edit its name and description.
- Save over the original, or save as a new file, possibly in another location.
- Discard unsaved changes.
- Notice when the file changed on disk while open, for example because an agent edited it, and
  decide what to keep.

### Steps

- Add a step at any position, delete a step, and change the order of steps.
- Edit every field of a step from the table above, including long instructions.
- Rename a step id. References to it in `route_back_to` follow the rename.
- Set, change or remove the condition, of any of the four kinds.
- Choose `consumes` from the artifacts that earlier steps produce. When a reorder breaks a
  `consumes` or `route_back_to` reference, the user sees it.

### Gates

- Add, edit and remove gates of each of the four kinds.
- For an `agent` gate: set `max_rounds`, and set or clear a review guide.
- Set `route_back_to` by choosing from the same and earlier steps.
- Understand the order in which the gates will actually run, which may differ from the order the
  user added them in.

### Validation

- Every rule in "Validation rules" is shown where it is broken, as the user edits.
- A workflow that breaks a rule can still be kept as a working copy, but not saved.

### Running workstreams

A workstream's progress is stored by step id. Renaming or deleting a step, or changing the order of
steps, can break work already in progress on that workflow. Where Komposer can find such
workstreams in the project, the user is warned before saving such a change.

## The visualization

The flow diagram shows the whole process at a glance. Beyond steps, their order and their
artifacts, which Komposer draws today, it must make these visible:

- `title`, `phase` and `description`.
- Which steps are optional, and the kind and text of each condition.
- Data flow: which step's artifact another step reads (`consumes`).
- Whether an artifact is produced, optionally produced or updated, its path, and whether it has a
  library guide, template and review guide.
- Each step's gates, by kind, in the order they run, with `max_rounds` and whether an `agent` gate
  has its own review guide.
- `route_back_to`: where work can be sent back to, from which gate.
- Where the workflow file lives.

Text, icons, pills, arrows or anything else may carry these; design explores and decides. The
diagram must stay readable for the largest workflow we have, `custom-example-large`, with 17 steps
and 18 artifacts, and for `_k-full-sdlc`, with 12 steps, 13 artifacts and three routes back.

## Workflow locations

fuse-flow finds workflows in three places: the project's own workflows, the user's personal
workflows, and the workflows that ship with fuse-flow. Inside each place, workflows may sit in
folders of any depth, such as `examples/superpowers/`. Komposer shows all of them and lets the user
tell them apart, without suggesting that some are less editable than others.

## Next: viewing a run

This part is forward-looking. Keep its design simple; we will expand it later.

Today the engine records each workstream's progress in a state file: every step's state, the
artifacts it recorded, the reasons the agent gave, the check results, and one timestamped history
line per event. We plan to replace the history lines with a **structured log** of step
transitions: for each event, the time, the step, the state before and after, who acted (the agent
or the owner), and the details, such as a skip reason, an owner's note, a check result or a review
round.

The user should be able to open one run and see:

- the workflow's flow diagram, with each step showing its state: not started, in progress, waiting
  for the owner, blocked, completed or skipped;
- the path the run took, including steps skipped, jumps forward and work sent back;
- for a selected step, its events in order, with times and details;
- how long each step took, and where the run waited for the owner.

The model is the AWS Step Functions execution view: a graph coloured by state, next to an event
history. Viewing a run is read-only.

## Out of scope

- Editing guides, templates and review guides.
- A library of gates or steps.
- Running, starting or continuing a workstream from Komposer.
- Comparing runs, or live updates of a running workstream.
- Collaboration features: comments, presence, sharing links.

## Decided by design

- How the screen is divided between the workflow list, the flow, the library and the step's
  details.
- How each informational attribute is represented in the diagram.
- How long instructions are edited.
- How gates are added and shown in their run order.
- How the library is browsed, and how an entry is added to a step: drag and drop, a picker, or
  both.
- How validation errors and the warning about running workstreams look.
- How a file that changed on disk is resolved.
- How a run is opened and shown.

## Sample content

A real step from the shipped `superpowers` workflow, to design against:

```yaml
  - id: implement
    title: Implement
    phase: Build
    instruction: >
      Execute the plan in the mode the owner chose, recorded in the plan's front matter, or
      implement the bounded design approved in chat. Work continuously: do not stop between tasks
      to check in. ...
    consumes: [design-spec, implementation-plan]
    updates:
      - artifact: code
        path: .
    gates:
      - check: default
      - agent: obtain a fresh review of the whole branch, from the commit it started at to HEAD
        guide: whole-branch-review.md
        max_rounds: 2
        route_back_to: plan
```

The complete files are in the fuse-konductor repository: `fuse/flow/workflows/` for workflows,
`fuse/flow/library/artifacts/` for library entries, and `fuse/flow/README.md` for the full format.
