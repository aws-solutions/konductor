# Concepts for the tutorial

The coach explains these at the user's depth. Each entry has a one-line menu text, then "short",
"normal" and "deep" material. "Normal" includes "short", and "deep" includes both. "In Komposer"
says where to point. The source of truth for the format is the `fuse-flow-builder` skill and
`fuse/flow/README.md` in the clone; check them when a question goes beyond this file.

## workflow

Menu: the process a piece of work follows, as an ordered list of steps.

- Short: a workflow is a YAML file listing steps in order. fuse-flow reads it and tells the agent
  which step comes next.
- Normal: `version: 1`, a `name` matching the file name, a `description` an agent shows when it
  offers workflows, and `steps`. Steps run one at a time, in file order; there are no loops and no
  parallel steps. A workflow lives in one of three places: the project's `.konductor/workflows/`,
  your `~/.konductor/workflows/`, or the official ones in the clone. A name is looked up in that
  order, at any depth.
- Deep: fuse-flow reads the workflow again on every command, so an edit affects workstreams already
  running on it. Their progress is stored by step id, so renaming or removing a step breaks them;
  Komposer warns before such a save. A name found twice in one place is refused.
- In Komposer: the list on the left; the diagram is one workflow.

## step

Menu: one unit of work, with an id, an instruction and what it reads and writes.

- Short: a step is one thing the agent does before moving on, such as "write the spec".
- Normal: each step has a unique `id` (lower-case letters, digits, hyphens) and an `instruction`.
  `title`, `description` and `phase` are for readers and for Komposer; they do not change what the
  engine does. A `phase` groups consecutive steps in the diagram.
- Deep: the current step is the first that is neither completed nor skipped. A step's states are
  pending, in progress, awaiting the owner, blocked, completed and skipped.
- In Komposer: each card in the diagram; the Step tab edits it.

## instruction

Menu: what the step must achieve, written for an agent that knows nothing else.

- Short: the instruction opens the step block the agent reads, so it says what the step must
  achieve.
- Normal: keep it self-contained. When the procedure grows beyond a paragraph, or the same kind of
  document appears in several workflows, move the procedure into a library guide. Komposer fills an
  empty instruction from the library's description when you add an artifact.
- Deep: Komposer keeps extending its own generated lines, one per artifact, until you edit them;
  then it leaves the instruction alone.

## artifact

Menu: a file a step produces, may produce or updates, and later steps read.

- Short: an artifact is a document or the code a step writes, such as a spec. It has an id, the
  kind of document, and a path.
- Normal: `produces` is a file the step must create; the engine refuses to move on until it exists
  or the agent says why it was not produced. `optional_produces` may be created. `updates` is a file
  or folder the step changes, usually `code` at path `.`; the agent reports what it changed.
  `consumes` lists ids from earlier steps that this step reads. Put `{slug}` in a path so two
  workstreams in one repository do not overwrite each other's files.
- Deep: the id is also the key into the library, so name the kind of document (`design-spec`), not
  the step, and never reuse an id for a different kind of document. `fuse-flow validate` catches a
  `consumes` id that no earlier step produces. The project's policy can move an artifact's path.
- In Komposer: the chips on a card; Outputs and Consumes in the Step tab; arrows in the diagram.

## library

Menu: the shared guides, templates and review guides for each kind of artifact.

- Short: the library has one entry per kind of artifact. Its guide tells the agent how to produce
  that kind of document.
- Normal: an entry is a folder `library/artifacts/<id>/` with `guide.md`, an optional
  `template.<ext>`, an optional `review.md` for agent gates, and `entry.yml` with a one-line
  description. There are three levels: the project's `.konductor/library/`, your
  `~/.konductor/library/`, and the one that ships with fuse-flow. The most specific entry wins as a
  whole.
- Deep: many shipped guides are links to fuse-konductor skills, for example `design/guide.md` to
  the `design-doc-guidelines` skill. Entries may be filed in folders below `artifacts/`; an id is
  found at any depth, and an id filed twice in one library is refused.
- In Komposer: the Library tab; the G T R badge on an output opens its entry.

## gates

Menu: what must hold before a step counts as done: mechanical, agentic and owner gates.

- Short: gates end a step. Some are checked by a program, some by an agent's review, and some
  need you.
- Normal: the engine runs them in a fixed order, whatever their order in the file: mechanical
  gates first, then agent reviews, then owner actions. Each kind is a concept of its own below.
- Deep: `route_back_to` on any gate names the same or an earlier step the owner may send the work
  back to. It is a suggestion printed for the owner, not automatic control flow.
- In Komposer: the coloured pills on a card; Gates in the Step tab.

## mechanical gates (check and script)

Menu: a command that must succeed, run by fuse-flow itself.

- Short: a mechanical gate is a command that must exit successfully, so the agent cannot just
  claim the work is fine.
- Normal: `check: default` names the project's own check, such as its build and tests; the
  project's policy binds it to a command, and the first time, the agent finds the command, confirms
  it with you and records it. `script: <command>` is a literal command for facts that hold in every
  project, such as a clean git tree.
- Deep: other check kinds such as `build` or `lint` work once bound; a kind that does not apply can
  be bound to `none`. Never put a project's build command in a `script`, so the workflow stays
  usable in other projects.

## agentic gates (agent reviews)

Menu: an independent review by another agent, repeated until it finds nothing that must be fixed.

- Short: an agent gate asks for an independent review. The working agent fixes what must be fixed
  and asks again, up to a limit.
- Normal: the working agent classifies each finding as a required fix or a false positive, with the
  reason, and fixes the required ones. `max_rounds` (2 by default) caps the rounds that end with a
  required fix; at the cap the step is blocked and you decide. A review guide sets what counts as a
  required fix.
- Deep: which review guide applies, from the most specific: your local project policy, the team's
  policy, the project library's `review.md` for the artifact, the gate's own `guide`, your policy,
  your library, the shipped library. Without any, the agent reviews against the artifact's own
  guide or the gate's text.
- In Komposer: "reviews against" under an agent gate shows the guide in effect for each artifact.

## owner gates

Menu: a point where the step waits for your decision.

- Short: an `owner-action` gate makes the step wait for you, for example to approve a spec.
- Normal: place one where your judgment matters or a wrong approval is expensive later: an agreed
  spec, a plan, a merge. Not after every step. While it waits, the agent ends its message with a
  hand-over block saying what you can decide.
- Deep: jumping ahead, going back or skipping a mandatory step is always the owner's decision; the
  agent may recommend one and waits for you.

## condition

Menu: makes a step optional, decided when the step is reached.

- Short: a condition says when a step runs; otherwise it is skipped, with the reason recorded.
- Normal: it is written like a gate. A `script` or `check` condition runs a command: success runs
  the step. An `agent` condition is judged by the agent, an `owner-action` condition asks you.
- Deep: prefer a condition to a second copy of the workflow.

## policy

Menu: project settings that bind a portable workflow to one project.

- Short: policy fills in what a workflow leaves open, such as which command `check: default` runs.
- Normal: the project's `.konductor/policy-overrides.yml` (shared, in git) and
  `.konductor/policy-overrides.local.yml` (yours) can bind checks, move artifact paths, and set the
  review cap, guide or reviewer. `~/.konductor/policy-overrides.yml` holds your defaults.
- Deep: the order, from general to specific: the engine's defaults, your policy, the workflow, the
  team's policy, your local policy for the project.

## workstream

Menu: one piece of work following a workflow, with its own saved state.

- Short: a workstream is one run of a workflow, such as "login-change", in one project.
- Normal: the agent starts it with a short name; its state is saved after every command in
  `.konductor/workstreams/<name>.yml` in the project, so a later session continues where the last
  one stopped. Several workstreams can run in one project, each on its own workflow.
- Deep: a workstream stays in the checkout where it started. fuse-flow prints a step block with
  the instruction, the files to read and write, and the exact command to continue; `continue`
  refuses, and says why, while an artifact is unaccounted for or a mechanical gate fails.
- In Komposer: the runs select above the diagram shows a workstream step by step.
