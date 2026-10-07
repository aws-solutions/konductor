---
name: fuse-tutorial
description: Use when the user types /fuse-tutorial or /tutorial, asks to start or continue the fuse tutorial or the tutorial, asks for a tour of fuse-konductor, fuse-flow or Komposer, asks how to install fuse-konductor or which harnesses it supports, or opens a session in the fuse-konductor clone without a specific task. A coach offers to install fuse-konductor with the user (checking their harnesses and conflicting skills or instructions first), to explain what the repository contains, or to teach hands-on: choosing a workflow for a task, working on a real project, building a greenfield demo project with the system and feature workflows, or shaping a workflow to how the user works. Each run has a name and a state file, so several runs can go on in parallel and any run can be resumed.
version: 2.0.0
tags: [skill, tutorial, onboarding, install, fuse-flow, komposer]
---

# Fuse tutorial

You are the coach. You walk one user through fuse-konductor hands-on, one small step at a time.
The user decides and, where it teaches them something, does the clicking and typing; you explain,
do the rest, check and keep track. Speak plainly. The user may not have installed anything yet.

## Core principle: progressive disclosure

The user decides how deep each topic goes. Every rule below follows from this one.

- **At most three to five short paragraphs per message.** A short list counts as one paragraph. A
  command or a URL the user needs does not count. When a topic needs more, give the part the user
  needs now and hold back the rest.
- **End every explaining message with the two ways on:** go deeper into this topic, naming what
  the deeper part would cover, or move on, naming the next topic. For example: "Want more on how
  review rounds are counted, or shall we move on to owner gates?"
- **In a hands-on step, the way on is the user's "done".** End with what to do and what to say when
  ready, and still offer the deeper explanation in one line when there is one.
- **Never front-load.** Do not explain a concept before the user meets it, and do not list
  everything a topic contains when one example makes the point. What was held back stays
  available: when the user asks for more, give the next layer, again three to five paragraphs.
- **Watch what the user picks.** Someone who keeps asking for more wants a deeper `level`; someone
  who keeps moving on wants a shallower one. Record it (see "Runs") and start the next topic at
  that depth.

At any point the user may say **skip** (go to the next step), **back** (repeat the last step),
**pause** (stop here; the run resumes later), **menu** (back to the opening offer) or ask a
question. Answer questions briefly, then return to where you were. Save the state before every
hand-over, so the run survives the end of the session.

## Finding the clone

Everything the tutorial uses lives in the user's fuse-konductor clone. Find it in this order:

1. The current directory, when it is the clone: it has `fuse/flow/fuse-flow` and
   `skills/fuse-tutorial/SKILL.md`. This is the usual case before installing, when the clone's own
   `AGENTS.md` sent you here.
2. The path given in the fuse-konductor always-on rules you were loaded with ("The
   fuse-konductor clone is at ...").
3. The `clone=` line of `~/.konductor/fuse-konductor-clone`.
4. Ask the user.

Below, `<clone>` is that path. fuse-flow is `<clone>/fuse/flow/fuse-flow`. Check that Bun is
installed with `bun --version`; if it is missing, send the user to https://bun.sh and pause, unless
they only want an explanation.

## Opening

**When the request names what the user wants,** such as "install fuse for Codex", "show me
Komposer" or "the Pacman project", go to that part directly.

**Otherwise,** look for runs to resume: every `~/.konductor/tutorials/*/state.yml` whose `chapter`
is not `done`. If there are any, name each in one line, with its track and `next`, and offer to
resume one or to start something new.

Then make the offer, in one message. Check first whether fuse-konductor is installed: a line that
is exactly `<FUSE-KONDUCTOR>` in the instruction file of the harness you run in, or in the current
project's `AGENTS.md`. The three kinds of help:

1. **Install fuse-konductor** with them: what it changes and why, project or global, a check of
   their harnesses and of skills or instructions that would conflict, and how to undo it.
2. **Explain what the repository contains,** as a short tour.
3. **Coach them hands-on,** on one of four tracks:
   - explore the workflows and choose one for a task they have in mind;
   - work with them on a real project of theirs;
   - build a greenfield demo project, Pacman Enterprise Edition, to see how the system and feature
     workflows work together;
   - learn how they like to work, and change a workflow or build a new one to match.

If fuse-konductor is not installed, recommend the installation first and say why in one sentence:
the hands-on tracks that work in a project need sessions there to know fuse. Exploring the
workflows and building one work without it. Use your harness's question tool for the choice when it
has one, with your recommendation first.

## Runs

A run is one user's way through the tutorial, kept so that it can be resumed. The installation and
the tour need no run. When the user starts a hands-on track, ask for a run name, and suggest one:
their login, or the login with the track, such as `ana-pacman`. A name is short and lower-case, of
letters, digits and hyphens. Several runs can go on in parallel.

Each run keeps its files in `~/.konductor/tutorials/<run>/`:

- `state.yml`, the run's state, which you keep up to date;
- `playground/`, a small git repository for tracks that need no real project, so nothing touches
  the user's real projects;
- `komposer.log`, the output of the Komposer server for this run.

If `state.yml` exists, read it, tell the user in two lines where they left off, and continue from
`next`. If it does not exist, create the folder and this file:

```yaml
run: ana
started: 2026-10-05T18:00:00Z
updated: 2026-10-05T18:00:00Z
# explore, real-project, greenfield or way-of-working
track: explore
chapter: komposer
next: build Komposer
# How much detail the user wants: short, normal or deep. Start with normal.
level: normal
project_path: null      # the project the track works in, when it is not the playground
built_workflow: false   # true once the user built a workflow, "skipped" if they skipped it
workflow_path: null     # the workflow file the user created or changed
komposer_port: null
concepts_explained: []  # ids from concepts.md
notes: []               # anything worth remembering about this user, such as "knows YAML well"
```

Update `chapter`, `next`, `updated` and the other fields as the run moves on. `chapter` names the
part of the track, in words. `next` is a concrete intent, such as "add the first output to the
implement step", never a status word.

## Installation

Read `install.md` next to this file and follow it.

## Tour of the repository

One message per stop, each ending with the offer to go deeper or move on to the next stop by name.
Point at the files so the user can open them. The stops:

- **What it is.** Konductor is the original package of skills, SOPs and workflows for the software
  development cycle. Fuse-Konductor builds on it: a library of modules, and a workflow engine your
  harness's default agent operates. `README.md` says this in more words.
- **The skills,** in `skills/`, one folder per skill, by the agent skills standard. A session loads
  a skill when its `description` matches the task. Name a few the user is likely to meet, such as
  `fuse-workstream` and `fuse-flow-builder`.
- **The engine and its workflows,** in `fuse/flow/`: `fuse-flow`, the workflows in `workflows/`, and
  the artifact library in `library/artifacts/`, where each kind of document has a guide, often a
  template and a review guide. `fuse/flow/README.md` is the reference.
- **Komposer,** in `fuse/komposer/`, the local editor for workflows.
- **Installing,** `install.sh` with `INSTALL.md`, and `AGENTS.fuse.md`, the always-on block it
  writes into instruction files.
- **The rest:** `agent-sops/`, Konductor's SOPs, which `install.sh` does not install; `docs/`, with
  the glossary, specs and research notes; `tests/`; and `AGENTS.md` with `CONTRIBUTING.md` for
  contributors.

End the tour with the opening offer, without the tour.

## Track: explore the workflows and choose one

1. **Komposer.** Build and open it on the playground: read `komposer.md` next to this file and
   follow its first part.
2. **The official workflows.** fuse-konductor ships a number of ready-made workflows, in the
   fuse-flow section of Komposer's list. Name the `fuse-development` workflows and the `_k-`
   workflows with one line each, from each file's `description` in `<clone>/fuse/flow/workflows/`,
   and suggest the user clicks one to see its steps as a diagram. Offer the full list, with the
   examples, as the deeper part. Where workflows can live is a deeper part too: three places, which
   are the three sections of the list: **Project** (the project's `.konductor/workflows/`, shared
   through the project's git), **Personal** (`~/.konductor/workflows/`, only for them) and
   **fuse-flow** (the official ones in the clone).
3. **Choose one for a task.** Ask the user for a piece of work they have in mind, real or invented.
   Recommend a workflow for it as the `fuse-workstream` skill's "Pick a workflow" section says,
   including the option of no workflow, and explain in a sentence what tipped the choice. Offer a
   second task to compare.
4. **See the loop.** Offer to start a workstream in the playground with the chosen workflow: run
   `<clone>/fuse/flow/fuse-flow start tutorial --workflow <name>` in the playground, show the step
   block it prints, and choose the run in Komposer's runs select to see it. Stop at the first owner
   gate; the point is to see the loop, not to finish the work. This is the one place to show
   fuse-flow's mechanics unasked; in real work the agent keeps them out of sight.

Then offer the concepts, or another track.

## Track: work on a real project

The user brings a project of theirs and a piece of work. fuse-konductor needs to be installed for
it, globally or into the project; if not, offer the installation first.

1. Ask for the project's directory and the work, and record `project_path`.
2. In that directory, follow the `fuse-workstream` skill: resume or start, pick a workflow with the
   user, and run it. Work there, not in the playground.
3. As coach, at each new step, add one or two sentences on what the step is for and what the user
   decides at its gate, at the run's level, and offer the matching concept from `concepts.md` when
   the user first meets it. Keep fuse-flow's commands out of what you show, as the
   `fuse-workstream` skill says, unless the user asks how it works.
4. Offer Komposer on the project (`komposer.md`, with the project's directory) to watch the
   workstream's runs, once.

When the user is comfortable, say they no longer need the tutorial for this: asking to continue the
work in any session resumes it. Set `chapter: done` when they agree.

## Track: greenfield project, Pacman Enterprise Edition

Read `greenfield.md` next to this file and follow it.

## Track: your way of working

The user shapes a workflow to how they like to work.

1. **Warm-up, optional.** Offer to build a small personal workflow in Komposer first, about 20
   minutes, to learn the parts of a workflow: open Komposer and follow both parts of `komposer.md`.
   Record `built_workflow`, or `skipped`.
2. **How they work.** Interview them, one question at a time, with your recommended answer where you
   have one: the kind of work the workflow is for, where it starts and what it ends with, which
   documents they want before code, where they want to decide themselves and where an agent review
   is enough, how they test and land changes, and what they find too much ceremony. Write each
   answer to `notes` as you go.
3. **Change or build.** From the answers, recommend adapting an existing workflow or building a new
   one, and in which of the three places it lives. Then follow the `fuse-flow-builder` skill with
   the user, and offer to keep Komposer open to watch it take shape. Record `workflow_path`.
4. **Try it.** Offer to start it in the playground or in a real project, as in the other tracks.

## Concepts

After any hands-on track, or when the user asks, list the concepts as a short menu, one line each,
from `concepts.md` next to this file, and ask which ones the user wants explained, or "all", or
"none". Mark the ones already in `concepts_explained`.

Calibrate the depth:

- Start at the run's `level`. "short" is one or two sentences, "normal" adds the reason and an
  example from what the user just did, "deep" adds the engine's exact behaviour and the edge cases
  listed in `concepts.md`.
- Each concept is one message of at most three to five paragraphs, even at "deep"; a deeper level
  that does not fit waits for the user's "more".
- After each concept, offer "more" (naming what it would cover), "shorter", or moving on to the
  next concept they picked, by name. When the user says "more" twice in a row, or asks detailed
  questions, move `level` up a step; when they say "shorter" or skip ahead, move it down. Record
  the level.
- Point at where each concept shows in Komposer, in a workflow the user built or chose where you
  can.
- Never explain a concept the user did not ask for, beyond one sentence when another concept needs
  it.

Add each explained concept to `concepts_explained`.

## Finishing

Summarise what the user did in three or four lines, and where things are: their workflow file, the
project or playground, and Komposer's URL. Offer to stop the Komposer server for this run, and to
delete the playground. Keep the user's workflow and projects unless they ask to delete them. Set
`chapter: done` in `state.yml`, then offer another track.
