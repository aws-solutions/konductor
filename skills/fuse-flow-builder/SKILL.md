---
name: fuse-flow-builder
description: Use when the user wants to create a new fuse-flow workflow or change an existing one, such as "build a workflow for our migration projects", "make fuse-feature-development lighter", "adapt this workflow to my team", or "add a security review to the workflow". Interviews the user about the use case, how rigorous and how token-hungry the process should be, and which artifacts to reuse, then builds the workflow with them, iterating in Komposer, following fuse's principles for workflows.
version: 0.1.0
tags: [skill, fuse-flow, workflow, builder, interview]
---

# Fuse flow builder

You help the user build a fuse-flow workflow that fits their work: a new one, or a change to an
existing one. This skill covers how to work with the user and what makes a good workflow. It does
not repeat what the repository already says:

- the format, the field reference, the checklist and the dry run are in the
  `fuse-workflow-authoring` skill, section 1; read it before you write or edit a file;
- the shipped workflows are in `<clone>/fuse/flow/workflows/`, and the artifact library, with a
  one-line description of each entry in its `entry.yml`, is in `<clone>/fuse/flow/library/`;
- Komposer, the local editor, is in `<clone>/fuse/komposer`; its `README.md` says how to start it.

Find `<clone>` as the fuse-konductor always-on rules say, or from the `clone=` line of
`~/.konductor/fuse-konductor-clone`, or ask.

## 1. Working with the user

### Interview with options, not open questions

Find out what the workflow is for before you propose anything. Ask in small rounds of one to three
questions. Give each question two to four concrete options, mark the one you recommend and why,
and accept any answer in the user's own words. "Lightweight, balanced or rigorous? I'd suggest
balanced, because ..." is easier to answer than "how much process do you want?". When you can read
or infer an answer from the repository, the project or what the user already said, state it as an
assumption instead of asking.

Cover these, in roughly this order, and stop asking once the answers are clear:

1. **The use case.** What work does the workflow cover, from what starting point to what result?
   Who runs it: one person with an agent, a team, or an agent working mostly alone? What goes
   wrong today without it? If nothing does, say that the workflow may not be needed.
2. **New or changed.** Offer the closest shipped or existing workflows as starting points, with
   one line each on what it would add or remove. Adapting one is usually better than starting
   empty. When the user wants to change a shipped workflow, recommend a copy in their personal or
   project folder, so a pull of the clone does not overwrite it.
3. **Rigour.** Offer three levels, with what each means for this use case:
   - lightweight: few steps, short or no documents, mechanical checks, one owner decision at the
     end;
   - balanced: a spec and a plan or design, an agent review before each owner decision, the
     project's checks on code;
   - rigorous: rich artifacts with templates, heavier guides, several review rounds, more owner
     decisions, end-to-end testing against the requirements.
4. **Token budget.** Does the user want to keep the agent's token use low? Low means shorter guides,
   fewer and cheaper review rounds, fewer documents, and reviews scoped to what changed. A generous
   budget allows independent reviewers on every important artifact and whole-artifact re-reviews.
5. **Artifacts: reuse or design.** Show the library entries that fit, by their descriptions, and
   ask whether to reuse them, adapt them in the project's or the user's library, or design new
   ones. Reusing keeps guides maintained by others; designing fits the team's house style.
6. **The owner's decisions.** Where does the user want to decide, and where should the agent carry
   on alone? Propose the points yourself, from the principles in section 2.
7. **Where it lives.** The project's `.konductor/workflows/` (shared through the project's git),
   the user's `~/.konductor/workflows/` (only for them), or the clone's `fuse/flow/workflows/`
   (for everybody who uses the clone).

Then write back your understanding in five lines at most, and let the user correct it.

### Komposer is there at any time

Early on, and again whenever the structure gets hard to follow in text, remind the user that they
can open the workflow in Komposer at any time to see it as a diagram: the steps, what each reads
and writes, the gates and the routes back. Also tell them that small tweaks, such as renaming a
title, rewording an instruction, adding a gate or moving a step, are often quicker to make there
than to describe to you. When they have made changes in Komposer, read the file again before your
next edit.

### Build in small iterations, and show the workflow

- **Propose a skeleton first:** the fewest steps that cover the work, each with its purpose, its
  artifact and its gates, and for each gate what it prevents. Agree on it before you write details.
- **Write the file early** and suggest the user opens it in Komposer while you iterate. If it is not
  running, offer to start it on their project (`bun run start -- <project>` in `<clone>/fuse/komposer`,
  after `bun install && bun run build` the first time) and give them the URL. Komposer reloads a
  file that changes on disk while it has no unsaved edits, so the user sees each of your changes in
  the diagram. Ask them not to edit in Komposer while you edit the file, or to tell you when they
  have, and read the file again before your next change.
- **Change one thing per round,** name it, run `<clone>/fuse/flow/fuse-flow validate <file>`, and
  show the user what changed: the diff, or "look at the review step in the diagram".
- **Offer suggestions, not questions,** at each round: "Next I'd add a condition so small changes
  skip the design; or we could stop here." Let the user steer.
- **Before you finish,** walk the authoring skill's checklist, offer the dry run, and summarise the
  decisions you made together and the ones you deferred.

### Suggest a smoke run at the end

When the user is done with a workflow, suggest a smoke run: an agent builds a hello world program
with the workflow, while a second agent plays the user and judges whether an ordinary engineer
could get through it. It catches high-level problems, such as a step that cannot be completed,
a missing guide, a gate that never passes, or confusing hand-overs. It is not a test of whether the
workflow is useful for real work; say so, so the user does not read a pass as more than it is.

- The command is `<clone>/fuse/smoke/run.sh --workflow <name or file>`. A name is looked up only
  among the shipped workflows and the smoke fixtures, so pass the file path for a personal or
  project workflow. A `<workflow>.policy-overrides` file and a `<workflow>.library/` folder next
  to the workflow file are copied into the smoke project too.
- It needs Bun, `kiro-cli` and `opencode` on the path, and by default Amazon Bedrock access through
  the AWS profile `opencode-bedrock` in `us-west-2`. `run.sh` without arguments prints the options.
- A run takes up to an hour, so suggest starting it in the background. The result is
  `verdict.md` in the run's folder under `~/fuse-smoke-runs/`. Exit code 0 is a pass, 2 is a pass
  with friction in the agent's guidance, and anything else is a failure to look into. Read the
  verdict with the user and turn each problem into a proposed change.

### Changing an existing workflow

fuse-flow reads the workflow again on every command, and a workstream's progress is stored by step
id. Before you rename, remove or reorder steps of a workflow that is in use, look for workstreams
on it in `.konductor/workstreams/` of the projects that use it, and tell the user what would
break. Adding a step, changing an instruction or adding a gate is safe for running workstreams;
the change applies from the next command.

## 2. Principles for workflows (draft)

These are fuse's principles for good workflows. They are a draft and will change after testing.
Use them to make proposals, and say which principle a proposal follows when that helps the user
decide. When the user wants something that goes against one, say so once, then do what they
decide.

### Sensible defaults, full configurability

A workflow should work out of the box and leave room for each project's house rules. Build in the
hooks fuse-flow offers, instead of writing one project's rules into the workflow:

- `check: default` instead of a build command; each project binds it in its policy.
- Review guides that a project can replace, through its own library entry or its policy.
- Artifact paths with `{slug}`, which a project's policy can move.
- Library entries a project can override with its own guide or template, by the same id.
- A `condition` where a step does not apply everywhere, instead of a second copy of the workflow.

### Embrace change

Models and harness features change every few months. Do not tailor a workflow to one model, one
harness or one tool's quirks. Do not name a model in a workflow; ask for "an independent reviewer,
preferably from another model family", and let the user's policy or setup choose it. State
instructions as outcomes and constraints, not as a script around today's limitations, so a better
model does better with the same workflow.

### Human attention is the bottleneck

The owner's time is the scarcest resource in the process. Spend it only where their judgment is
needed:

- Put an agent review before every owner decision, so the owner sees work that an agent has
  already tried hard to break.
- Place owner gates at decisions only the owner can make, or where a wrong approval is expensive
  later. Not after every step.
- Write templates and guides so that what needs the owner is at the top: the decisions needed, the
  open questions and the risks, each with the agent's recommendation. Not buried in the text.

### Skills, guides and always-on rules each have their place

- **A skill** is a general capability the agent chooses to use, based on its description, because
  it seems to solve the problem at hand. Do not make a workflow depend on a skill being picked.
- **A guide** holds instructions that must apply deterministically whenever a step produces a
  certain artifact. The engine points the agent at it every time.
- **Always-on rules** belong in the harness's rule system, such as `AGENTS.md` or Kiro steering
  files, not in a workflow.

### A reviewer is not an authority

A review informs the author; it does not decide. A reviewer can be wrong, and it often lacks
context the author has, such as a decision the owner already made, so it raises false positives.
Write review gates and review guides so that:

- the author analyses every finding and accepts or rejects it, with the reason, instead of fixing
  whatever is raised;
- a finding the owner has already accepted or deferred is not a required fix;
- the reviewer says whether a finding is a single instance or a broken pattern. A single instance
  is fixed where it is. A broken pattern is fixed everywhere it occurs, and the author looks for
  the other occurrences before calling it fixed, so the next round does not find the same problem
  one place further on.

### Give the agent ways to check its own work

Evidence beats claims. Give each step that changes code something that can fail: `check: default`
bound to the project's type check, linter and tests. Ask for acceptance tests written from the
spec, not from the code, and for each test to be seen failing. Use targeted agent reviews, whose
review guide says what to look for, rather than "review everything".

### Let smart agents think

Do not restrict an instruction to the cases you can foresee. State the goal, the constraints and
what good looks like, and let the agent handle the rest. Invite the agent to raise better
approaches, risks and ideas the owner did not mention, as suggestions for the owner to decide on.

### Avoid scope creep

A feature and its review should not grow while they are being built. Encourage agents to suggest
splitting a feature or deferring an extension, and to deliver the feature at hand. Keep reviews to
the change and its spec. Give artifacts a place for what was deferred, so a good idea is recorded
instead of built. Thinking widely and acting narrowly go together: ideas go to the owner, not into
the change.

### Keep each step resumable from its artifacts

Sessions end, contexts get compacted, and a later step may run with another agent. Each step
should be doable by a fresh agent from its instruction and the artifacts it consumes. So write
decisions, agreements and open questions into artifacts, not only into the conversation.

### As simple as possible, as rigorous as needed

Every step, artifact and gate is something the agent has to follow and the owner has to read. Add
one only for a need the user stated or a principle above, and say what it prevents. The authoring
skill lists the signs that a workflow has grown too heavy.
