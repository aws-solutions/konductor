# Fuse debug mode

Debug mode lets the owner watch fuse at work, turn by turn, and catch its bugs as they happen. While
it is on, every reply to the owner ends with a fuse report: a diagram of the workflow, then four
labelled lines that say where the workflow stands, what comes next, which fuse instructions the
agent used, and what surprised it. The agent also keeps a log of every turn.

Load this guide only when the owner asks to turn debug mode on or off, or when an always-on section
says that debug mode is on.

## Turn it on

1. Ask where it applies, unless the owner said: this project (the default), or all of the owner's
   projects.
2. Add the section below to an instruction file the harness loads in every session, outside any
   block another tool manages. For this project, that is the project's `AGENTS.md`; tell the owner
   that this file is committed and shared with the team. For all projects, it is the owner's global
   instruction file, such as `~/.claude/CLAUDE.md` or `~/.config/opencode/AGENTS.md`. Replace
   `<guide>` with the absolute path of this file.

   ```markdown
   ## Fuse debug mode

   Fuse debug mode is on. At the start of each session, read `<guide>` and follow it: end every
   reply to the owner with the fuse report it describes. Only the agent that talks to the owner
   writes the report; subagents, reviewers and judges never do. To turn debug mode off, the owner
   asks for it, and the agent removes this section.
   ```

3. Confirm in one sentence where you added it, and end this reply with the first report.

## Turn it off

Remove the section from the file where it was added, and confirm in one sentence. Keep the log; it
is the record of fuse bugs found. Delete it only when the owner asks.

## What it changes

- **Lifted:** "Keep fuse-flow behind the scenes", from the always-on fuse-konductor rules. You may
  name steps, gates, review rounds, guides, templates, policy files, sections of the always-on
  rules and fuse skills.
- **Still hidden unless the owner asks:** fuse-flow commands, their flags, and the workstream's
  state file.
- **Kept:** the rest of "Writing for the owner", and the hand-back lines the step block asks for.
  The report comes after them; it never replaces them.

## Who writes it and when

- Only the agent that talks to the owner. When you dispatch a subagent, reviewer or judge, tell it
  not to write a report, because it loads the same instruction files.
- At the end of every reply to the owner, including replies with no workstream active and replies
  that start because background work finished.

## The report

The dashboard and most chat views render Markdown and join single line breaks into one paragraph.
So the diagram goes in a code block, and every labelled line is a list item with a bold label.

````markdown
**Fuse report**

```text
1 intake        [done]     owner approves
2 requirements  [HERE]     agent review 2/2 -> owner approves   <- waiting for the owner
3 design        [ ]        agent review 0/2 -> owner approves
4 prototypes    [skipped]
```

- **FUSE STEP:** the requirements step instruction and the requirements template; agent review,
  round 2 of 2.
- **FUSE NEXT:** the owner approves the requirements or asks for changes; then the design step.
- **FUSE USED THIS TURN:** the requirements step instruction; the review guide (first use); the
  project policy file.
- **FUSE SURPRISES:** none.
````

### The diagram

- One line per step, in workflow order, with its number, its id and its state. Take the states from
  `fuse-flow status <slug>`: `[done]` for completed, `[HERE]` for the current step (in progress,
  awaiting the owner or blocked; add `blocked` or `waiting for the owner` as a note), `[skipped]`
  for skipped, `[ ]` for pending.
- After the state, the step's gates in order, such as `checks -> agent review 2/2 -> owner approves`.
  The review count is rounds used of the cap. Rounds used is the number of findings files for that
  step and gate in `.konductor/reviews/<slug>/`; the cap is the step's cap plus any rounds the owner
  granted, as the step block or `fuse-flow status` shows.
- A short note after `<-` is welcome, such as `<- update proposed`.
- Rebuild the diagram from the current status every turn. With no workstream active, leave it out.

### The four lines

| Line | What it says | When there is nothing to say |
| --- | --- | --- |
| FUSE STEP | The guide being followed (a step instruction, an artifact guide or template, a review guide), and the gate in progress with its round | "no workstream active" |
| FUSE NEXT | What the workflow asks for next, and who acts | always filled |
| FUSE USED THIS TURN | Every fuse item read or followed: fuse skills, sections of the always-on rules, step instructions, guides and templates, review guides, policy files. Mark an item `(first use)` the first time this workstream uses it | "none" |
| FUSE SURPRISES | Anything fuse did that surprised you: an unexpected refusal, a status that looks wrong, an unclear or conflicting instruction, an output that failed in practice | "none" |

## The log

- **Where:** `.konductor/debug/<slug>.md` in the project, one file per workstream, and
  `.konductor/debug/no-workstream.md` for turns with none active. If `.konductor/debug/` has no
  `.gitignore`, create one that contains `*`, so the log stays out of commits.
- **What:** one line per turn, appended before you write the report: the time in UTC, the step (and
  any move to another step), what the turn used, and any surprise.
- **Use:** it is how you know what counts as a first use. When you pick up a workstream in a new
  session, read its log before the first report.
