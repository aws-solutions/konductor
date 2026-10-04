---
name: fuse-workflow-authoring
description: Use when creating, editing or reviewing a fuse-flow workflow definition (a `.yml` file under `fuse/flow/workflows/`, `.konductor/workflows/` or `~/.konductor/workflows/`), when turning an existing process such as prose, an SOP, agent specs or a set of skills into a fuse-flow workflow, or when designing a new workflow with the user from a rough idea. Covers the workflow format from required to optional features, how to turn skills into artifact guides and checkpoints into gates, and how to keep a workflow as simple as its purpose allows.
version: 1.0.0
tags: [skill, fuse-flow, workflow, authoring]
---

# Fuse workflow authoring

fuse-flow has two parts. The **workflow** is the process to follow: an ordered list of steps, the
artifacts each step reads and writes, and the gates that end each step. The **engine** reads the
workflow and the workstream's state, and tells the agent the next step deterministically. It
refuses to move on while a required artifact is unaccounted for or a mechanical check fails, and it
hands decisions to the owner where the workflow asks for one.

The engine exists to keep an agent on the intended process: a deterministic next step, one
standard definition of the process, and nothing forgotten by accident. It does not exist to force
people through a process that does not fit their situation. Every feature you add to a workflow is
something the agent has to follow and the owner has to read, so add a feature only when it serves
the workflow's purpose.

Use this skill in one of three modes:

- **Reference** (section 1): you need to know what a field does, or you are editing a workflow.
- **Encoding** (section 2): you are given an existing process to turn into a workflow.
- **Design** (section 3): there is no blueprint, and you build the workflow with the user.

## Before you start

- **Find the fuse-konductor clone.** `~/.konductor/fuse-konductor-clone` holds one line,
  `clone=<path>`. The engine is `<clone>/fuse/flow/fuse-flow`. The full contract is
  `<clone>/fuse/flow/README.md`, and the field definitions are in `<clone>/fuse/flow/src/schemas/`.
- **Read the existing examples:** every `.yml` in `<clone>/fuse/flow/workflows/`, and the artifact
  library in `<clone>/fuse/flow/library/artifacts/`. `examples/superpowers/superpowers.yml` is the
  most complete example of a native workflow, and keeps its own review guide in its folder.
  `_k-full-sdlc.yml` shows a long workflow whose guides link to skills shipped in the clone.
- **Choose where the workflow lives.** fuse-flow looks a name up in these locations, at any depth
  below each, and the first location with a match wins:

  | Location | Use it for |
  |---|---|
  | `.konductor/workflows/` in the project | a workflow for one project, shared through its repository |
  | `~/.konductor/workflows/` | your own workflows, across projects |
  | `<clone>/fuse/flow/workflows/` | workflows that ship with fuse-konductor |
  | `<clone>/fuse/flow/workflows/personal/` and `team/` | gitignored folders for personal and team workflows |

  Two files with the same name in one location are refused as ambiguous, so pick a unique name.
- **Validate after every edit:** `<clone>/fuse/flow/fuse-flow validate <file>`.

## 1. How a workflow definition works

### The minimum

```yaml
# $schema: ./schemas/workflow.schema.json
# yaml-language-server: $schema=./schemas/workflow.schema.json
version: 1
name: small-change
description: One reviewed change, from an agreed description to a merged branch.
steps:
  - id: describe
    instruction: Agree with the owner on what the change does and how it will be verified.
  - id: implement
    instruction: Implement the agreed change test-first and run the project's checks.
```

- `version` is always `1`. `name` matches the file name. `description` is what an agent shows the
  owner when it offers workflows, so write it for that reader.
- Steps run one at a time, in file order. There is no parallel execution and no automatic jump.
  The current step is the first one that is neither `COMPLETED` nor `SKIPPED`.
- Step identifiers are lower-case letters, digits and hyphens, and unique. A workstream's state is
  keyed by step identifier, and the engine reads the workflow again on every command. Renaming or
  removing a step therefore breaks workstreams already running on that workflow. Check
  `.konductor/workstreams/` in the projects that use it before you do.
- The two comment lines enable editor validation when the file sits next to `schemas/`. Adjust the
  relative path when it does not.

### Features, from required to optional

Reach for them in this order, and stop as soon as the workflow does what it is for.

1. **`instruction`** (required). It opens the step block, so it is the first thing the agent reads.
   Say what the step must achieve, for an agent that knows nothing else about the work. Keep it
   self-contained: do not depend on a skill, script or tool that may not be installed where the
   workflow runs. When the procedure grows beyond a paragraph, or the same artifact appears in
   several workflows, move the procedure into an artifact guide.
2. **`title`, `description`, `phase`.** Information for readers, `status` and the Komposer viewer.
   They do not change what the engine does. A `phase` groups consecutive steps in the viewer.
3. **`produces`.** An artifact the step writes, as `artifact: <id>` and `path: <path>`. The engine
   refuses `continue` until the file exists, or the agent reports
   `--not-produced <id> "<reason>"`. Use it whenever the point of a step is a document someone
   will read later.
   - Put `{slug}` in the path, such as `docs/specs/{slug}.md`, so two workstreams in one
     repository do not overwrite each other's files.
   - The identifier is also the key into the artifact library. Name the kind of document, such as
     `design-spec`, not the step. Check the library before inventing an identifier, and never reuse
     an existing identifier for a document with a different purpose, because its guide would
     apply.
4. **`consumes`.** Artifact identifiers from earlier steps that this step reads. The step block
   prints each as a `READ` line with its resolved path. `validate` catches an identifier that no
   earlier step produces, which prose cannot.
5. **`updates`.** Files the step changes rather than creates, usually code: `artifact: code`,
   `path: .` for the whole repository, or a narrower directory. The agent reports each changed
   file with `--updated <file>`, or the whole artifact with `--unchanged <id> "<reason>"`. The
   engine checks that the agent accounted for it, not that something changed.
6. **`gates`.** What has to happen before the step counts as done. The engine runs them in a fixed
   order, whatever their order in the file: mechanical gates, then agent reviews, then owner
   actions.
   - **`owner-action: <what the owner does>`.** The step waits in `AWAITING_OWNER` until the
     owner acts. Place it where the owner's judgment is needed or an approval is expensive to get
     wrong later: an agreed spec, a plan before implementation, a merge. Not after every step.
   - **`check: <kind>`.** A project-specific check that policy binds to a command. Prefer
     `check: default`, the project's one check for agents, such as `bun run check`. When no
     command is bound, the agent finds one, confirms it with the owner and records it in
     `.konductor/policy-overrides.yml`. Kinds are single lower-case words; `build`, `test`, `lint`
     and `typecheck` are examples of further kinds.
   - **`script: <command>`.** A literal shell command, run from the repository root, that must
     exit 0. Use it for a fact that holds in every project, such as
     `test -z "$(git status --porcelain)"` for a clean tree. Keep it portable, and never put a
     project's build command here.
   - **`agent: <what to review>`.** The maker obtains an independent review, classifies each
     finding as a required fix or a false positive, fixes what is required and reviews again.
     `max_rounds` (default 2) caps the rounds that end with a required fix; at the cap the agent
     reports the step blocked and the owner decides. `guide:` names a review guide relative to the
     workflow file. The guide decides what counts as a required fix and when a round passes; the
     cap and the blocked exit still apply.
   - **`route_back_to`** on any gate names the same or an earlier step the owner may send the work
     back to. It is a suggestion printed for the owner, not automatic control flow.
7. **`condition`.** Makes the step optional, written as one gate-kind mapping. A `script` or
   `check` condition runs when the step is reached: exit 0 runs the step, anything else skips it.
   An `agent` condition is judged by the agent, and an `owner-action` condition asks the owner. A
   skipped step records its reason. Prefer a condition to a second copy of the workflow.
8. **`optional_produces`.** An artifact the step may write. It is recorded when it exists and
   never refuses `continue`.

### The artifact library

An artifact identifier selects one folder:

```text
library/artifacts/<id>/
  guide.md          how to produce the artifact
  template.<ext>    optional structure for it
  review.md         optional review guide for agent gates on steps that produce it
```

The engine looks in the project's `.konductor/library/`, then `~/.konductor/library/`, then the
package's `fuse/flow/library/`, and the first folder found wins as a whole. The step block points
the agent at the guide and template; the engine never copies or edits them.

- A guide is the procedure for producing one kind of document, in the spirit of a skill. Write it
  for the agent, and leave out what the engine already does: the order of steps, which skill comes
  next, and approvals, which are gates.
- A template fixes the structure when the structure matters to a later reader or step, such as a
  plan header the implementer relies on.
- A guide may tell the agent to keep a status in the artifact, for example `status: draft` in front
  matter, changed to `approved` when the owner approves. This lets someone reading the file
  without fuse-flow see where it stands. The engine only reminds the agent; its own record is the
  state file.
- A guide may be a relative symlink to a skill in the clone's `skills/` folder, as in
  `library/artifacts/design/guide.md`. Do that only for skills that ship with fuse-konductor; a
  link to a skill that is not installed is a missing guide, and the agent then has to ask the
  owner.

### Policy, so a workflow stays portable

A workflow describes the process; policy binds it to a project. A project's
`.konductor/policy-overrides.yml` (team, in git) and `.konductor/policy-overrides.local.yml`
(personal) can bind check kinds, move artifact paths, and set the review cap, guide or reviewer.
`~/.konductor/policy-overrides.yml` holds personal defaults. So do not write a project's commands,
paths or reviewer into a workflow meant for several projects; use `check: default` and let policy
fill it in.

### What the engine does not do

Design within these limits instead of working around them:

- **One checkout per workstream.** State is kept, and checks run, in the checkout where `start`
  ran. A workflow cannot move its work into a new worktree halfway. If isolation matters, the
  owner creates the worktree first and starts the workstream inside it.
- **No loops and no parallel steps.** Work per item is either one step whose instruction covers
  every item, or one workstream per item. Parallel work happens inside a step, for example with
  subagents.
- **No automatic routing.** `--back-to`, `--forward-to`, `start --from` and skipping a mandatory
  step are the owner's decisions. A workflow may tell the agent when to suggest one.
- **No counting.** The engine prints the review cap; the agent counts rounds.

### Checklist for a finished workflow

- Every step has one purpose, and a step boundary sits where an artifact is handed on, a gate
  applies, or a context reset is likely.
- Every `produces` and `optional_produces` path contains `{slug}`, unless the workflow is meant
  to share one file across workstreams.
- Every artifact identifier either has a library entry or is simple enough for the instruction to
  describe.
- Every gate prevents something specific from going wrong silently. You can say what.
- Owner gates sit at the decisions only the owner can make.
- No instruction depends on a tool, skill or path that will not exist where the workflow runs.
- `validate` passes, and a dry run looks right (below).

### Dry run

In a scratch git repository, outside any real project:

1. `git init`, an empty commit, then `<clone>/fuse/flow/fuse-flow start trial --workflow <file>`.
2. Read each step block as the agent will. Every `PRODUCE` line should name a guide where you
   expect one, and none should say a guide is missing.
3. Create placeholder files and run `continue` with the flags each block asks for, through every
   step. Check the conditions, refusals and hand-over blocks.
4. Delete the scratch repository.

For a shipped workflow, also run `bun test` in `<clone>/fuse/flow`, which checks that every
shipped workflow validates and that its guides resolve.

## 2. Encoding an existing workflow

You are pointed at a process that already exists: prose, an SOP, agent specs, or a set of skills
that call one another. Treat it as the complete specification. Work autonomously, and ask the
owner only when the source contradicts itself in a way that changes the workflow, or requires
something the engine cannot express and no reasonable adaptation exists. Record every other
judgment call as a deviation and report it at the end.

### Procedure

1. **Collect the whole source.** Read the entry document, then every skill, spec, prompt or script
   it invokes, following references until nothing new appears. Note the source's location and
   licence.
2. **Inventory it.** For each stage, write down what it produces, what it reads, who acts, what
   ends it (an approval, a check, a review), what loops back, what is optional, and what makes it
   stop.
3. **Map each element** with the table below.
4. **Draw the step boundaries.** A step boundary goes where the source hands something on: a
   document to a later stage, or a decision to a person. The internal moves of a skill, such as
   asking one question at a time, stay inside the step.
5. **Write the guides** (below), then the workflow file.
6. **Check fidelity.** Walk the source again from the top. Every "must", approval, review, check
   and stop condition has to appear in an instruction, a guide or a gate. Write every deliberate
   deviation, and why, into the comment at the top of the workflow file.
7. **Validate and dry-run** as in section 1.
8. **Report** the mapping, as a table from source element to fuse-flow element, and the deviations.

### Mapping table

| In the source | In fuse-flow |
|---|---|
| A stage that ends with a document | A step with `produces` |
| A skill or section that says how to write a document | That artifact's `guide.md` |
| A required format, header or section list | That artifact's `template.<ext>` |
| A procedure for reviewing a document | Its `review.md`, or `guide:` on the agent gate |
| A procedure with no document, such as test-driven development or debugging | Its essence in the step's `instruction` |
| "Wait for the user", "get approval", "the user chooses" | `owner-action` gate |
| "Run the tests", "the build must pass" | `check: default` |
| A fixed command that holds in every project | `script` gate |
| "Review until clean", "at most N rounds" | `agent` gate with `max_rounds: N` and a review guide holding the pass rule |
| "If this applies", "skip for small changes" | `condition` |
| A stage that may legitimately produce nothing | An instruction saying when to report `--not-produced` and with which reason |
| "Go back to stage X" | `route_back_to: X` on the gate where that happens |
| A loop over features or items | One step whose instruction covers every item, or one workstream per item |
| Parallel branches | Sequential steps, or subagents inside one step |
| A ledger, scratch state or progress file | A git-ignored file the instruction describes, not an artifact, unless a person reviews it |
| Helper scripts that ship with a skill | Their intent in the instruction or guide; never a dependency |
| "Invoke skill X next" | Nothing: the step order is the engine's job |

### Skills: guide, instruction, or reference

- **A skill that produces a document becomes that artifact's guide.** If the skill ships with
  fuse-konductor, the guide may be a relative symlink to its `SKILL.md`. If it comes from
  elsewhere, write the guide in your own words, in the spirit of the original, with a line
  crediting the source and its licence. Do not copy a third-party skill verbatim.
- **When you write a guide, adapt it to fuse-flow.** Remove announcements, "invoke the next
  skill" hand-offs and approval steps; the engine and the gates do those. Replace the source's own
  file locations with the step's path. Keep the questions, the method and the self-review.
- **A skill that describes how to work, without producing a document, goes into the instruction**
  of each step that needs it, reduced to the rules that change the agent's behavior.
- **Keep a dependency on an installed skill only when the workflow will never leave the machines
  that have it,** and say so in the file's header comment.

### Example

`fuse/flow/workflows/examples/superpowers/superpowers.yml` encodes [obra/superpowers](https://github.com/obra/superpowers):

| Superpowers | superpowers.yml |
|---|---|
| brainstorming | `design` step; `design-spec` guide and template; owner approval |
| bounded change, design approved in chat | `--not-produced design-spec "bounded change"` |
| writing-plans | `plan` step; `implementation-plan` guide and template; `agent` condition; owner approval |
| using-git-worktrees | `workspace` step on a branch, because state stays in one checkout (a recorded deviation) |
| subagent-driven development, executing-plans, test-driven development, debugging, verification | the `implement` instruction |
| requesting-code-review, final review | `agent` gate with `whole-branch-review.md` as its guide |
| finishing-a-development-branch | `finish` step with `check: default`, a clean-tree `script` gate and the owner's choice |

## 3. Building a workflow from scratch with the user

There is no blueprint, and the user may only have a rough idea. The aim is a workflow as simple as
possible and as sophisticated as necessary, and only its purpose tells you which is which. So
find out what it is for before you propose anything. The `socratic-elicitation` skill helps with
the questioning.

### Procedure

1. **Elicit the purpose,** one question at a time, preferring multiple-choice questions:
   - What work does the workflow cover, from what starting point to what result?
   - Who runs it: one person with an agent, a team, or an agent that runs unattended?
   - What goes wrong today without it? Forgotten steps, missing reviews, skipped approvals and
     documents nobody wrote are what gates and artifacts are for. If nothing goes wrong, the
     workflow may not be needed.
   - Which documents must exist at the end, and who reads them?
   - Where does the user want to decide, and where should the agent carry on alone?
   - Does the project have a check command for agents, and where does the code live?

   Write back your understanding in a few lines, and let the user correct it.
2. **Look for a starting point.** List the shipped workflows and library entries that come close,
   and say what each would add or remove. Adapting an existing workflow, and reusing library
   guides, is usually better than starting empty.
3. **Propose a skeleton:** the fewest steps that cover the work, each with its purpose, its
   artifact if any, and its gate if any. For every gate, say what it prevents.
4. **Add sophistication only for a stated need.**

   | The user says | Add |
   |---|---|
   | "I keep forgetting to run the tests" | `check: default` on the step that changes code |
   | "I want a second opinion on the design" | an `agent` gate on the design step |
   | "I decide before any code is written" | an `owner-action` gate on the spec or plan step |
   | "Small changes don't need a design" | a `condition` on the design step |
   | "I run several of these at once" | `{slug}` in every artifact path |
   | "Our team writes specs a particular way" | a library guide, and a template if the structure matters |
   | "Different projects check differently" | `check: default`, bound in each project's policy |
   | "If the review finds a design flaw, it goes back" | `route_back_to` on that gate |

   When the user wants something the engine does not do, such as parallel branches, say so and
   offer the closest fit from section 1.
5. **Write guides where they pay off:** where an instruction would run past a paragraph, or the
   same document appears in several workflows. Otherwise the instruction is enough.
6. **Write the file, validate it, and dry-run it with the user.** Show them the step blocks the
   agent will see, and adjust until they recognize their process in it.
7. **Agree where it lives,** from the table in "Before you start".

### Signs a workflow has grown too heavy

- An owner gate on every step, so the owner approves work they never needed to see.
- A review on every artifact, whatever the risk.
- Process the user did not ask for, carried over from an example.
- Instructions that repeat what a guide already says.
- A project's own commands or paths written into a workflow meant for many projects.
- Several near-identical workflows where one with a condition would do.
