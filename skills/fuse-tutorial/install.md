# Installing fuse-konductor with the user

The goal: the user ends up with fuse-konductor installed where they want it, knows what changed and
why, and knows how to undo it. `<clone>` is the clone, as `SKILL.md` defines it. `INSTALL.md` in
the clone is the reference; this file says how to walk the user through it. The usual rules hold:
three to five short paragraphs per message, and the deeper part only when the user asks.

Work in four parts: look around, explain, decide, install. When the user already knows what they
want, such as "install it globally for Claude Code", look around, say in a few lines what the
command will change and what you found, and go straight to running it.

## 1. Look around first

Do this yourself, read-only, before explaining anything, so the explanation is about the user's
machine and not a general one. Tell the user in one line that you are looking.

**Be careful in the home directory.** Check whether the paths below exist, list the names in skills
folders, and read the instruction files named below. Do not open anything else in these folders:
they also hold credentials, login tokens, session transcripts and history, which you must not read.
Do not search the whole home directory.

**Prerequisites.** `git --version` and `bun --version`. `install.sh` refuses to install without Bun;
if it is missing, send the user to https://bun.sh and continue once they have it. On Windows, the
user needs WSL.

**Harnesses on this machine.** A harness counts as present when its folder exists or its command is
on the `PATH` (`command -v`). You also know which harness you are running in; say so.

| Harness     | Signs                             | User-level instruction file      | Support                                   |
| ----------- | --------------------------------- | -------------------------------- | ----------------------------------------- |
| Claude Code | `~/.claude/`, `claude`            | `~/.claude/CLAUDE.md`            | project or global                         |
| Codex       | `~/.codex/`, `codex`              | `~/.codex/AGENTS.md`             | project or global                         |
| OpenCode    | `~/.config/opencode/`, `opencode` | `~/.config/opencode/AGENTS.md`   | project or global                         |
| Kiro CLI    | `~/.kiro/`, `kiro-cli`            | `~/.kiro/steering/AGENTS.md`     | project or global; see custom Kiro agents |
| Cursor      | `~/.cursor/`, `cursor-agent`      | none                             | project only                              |

Note any other agent harness you recognise, for example from `~/.gemini/`, `~/.codeium/`,
`~/.copilot/` or an `~/.aider.conf.yml`. `install.sh` has no preset for them; part 5 covers them.

**An existing install.** Read `~/.konductor/fuse-konductor-clone`. Look for a line that is exactly
`<FUSE-KONDUCTOR>` in each instruction file above that exists. If the clone file names a different
clone than this one, tell the user: the skills there were installed from the other clone, and
`install.sh` here skips them as not its own. They either keep using the other clone, or uninstall
from it first.

**Skills that would collide.** List the skill names in `<clone>/skills/`, and compare them with the
folders in each present harness's skills folder (`skills/` next to its instruction file, and
`~/.kiro/skills/` for Kiro CLI) and in `~/.agents/skills/`. For a project install, compare with the
project's `.agents/skills/`, `.claude/skills/` and `.kiro/skills/` instead. `install.sh` skips a
skill with the same name that it did not install and reports it, so the existing skill stays
active. Name each collision and what the existing skill appears to do, from its `description`.

**Instructions that overlap.** Read the present instruction files, and for a project install also
the project's `AGENTS.md` and `CLAUDE.md`. Look for rules that cover the same ground as fuse: another
workflow or spec-driven method (Konductor from the `main` branch, Superpowers, Kiro specs and
similar), a review mechanism, commit or branching rules, a testing policy, and rules that always
load certain skills. Look in the skills folders for skills with a similar purpose under another
name, such as brainstorming, plan writing or code review. These files can hold private notes:
summarise what you found in a line each, and do not quote them at length.

## 2. Explain

One message, at the run's level. The material:

- **Why install.** fuse-flow runs from the clone without installing anything. Installing teaches the
  agents in the user's other projects that fuse exists: where fuse-flow is, which skills to use, and
  when to bring fuse up. Without it, only a session opened in the clone knows.
- **What it writes.** The always-on block, `AGENTS.fuse.md` from the clone, which every session
  loads; every skill in `<clone>/skills/` (count them), whose names and descriptions every session
  loads; and the one-line file `~/.konductor/fuse-konductor-clone`. Where they go depends on the
  choice in part 3; `INSTALL.md` lists it.
- **What it leaves alone.** Everything in an instruction file outside its own markers, and any skill
  of the same name that it did not install.
- **How to undo it.** The same command with `--uninstall`. It keeps skills the user edited since,
  and keeps `~/.konductor/fuse-konductor-clone`, which other projects may use.

Then report what part 1 found: the harnesses, an existing install, and any collisions or overlaps,
each with what it means. Collisions and overlaps do not block the install. When one matters, say
what happens: a colliding skill stays the user's own, and when an overlapping rule and a fuse step
disagree, the agent asks the user which takes precedence and records the answer. Offer to settle
the ones you can see now, and record each ruling as the `fuse-workstream` skill describes.

The deeper part, on request: `--link` for people who edit the skills, how updates work, and custom
Kiro agents.

## 3. Decide: one project or everywhere

Lay out the choice, then ask one question with your recommendation first.

- **Global, for yourself** (`--global <file> ...`, one file per harness): every project on this
  machine gets fuse, and no repository changes. Nobody else is affected. Good for trying it out.
- **Into one project** (`--project <dir>`): the skills and the block are committed into the project,
  so teammates get them with `git pull`, and they are versioned with the project. It is the only way
  for Cursor. The cost is a large commit with every skill in it, which the user reviews first. Each
  teammate still runs `install.sh --project` once from their own clone, so their agents can find
  fuse-flow.

Recommend global for a user trying fuse out on their own machine, with one file for each supported
harness that part 1 found; ask which of them they use. Recommend a project install when a team
adopts fuse together, or when the user works in Cursor. The two can be combined.

## 4. Install

1. Show the exact command, run from the clone's root, and what it will change, in a few lines. Run
   it only after the user says yes.
2. Show its output. Explain every skipped or reported item in a line.
3. Check the result: the `<FUSE-KONDUCTOR>` line is in each instruction file, or in the project's
   `AGENTS.md`, and the skills folder has the fuse skills.
4. For a project install, show `git status` in the project and suggest the user reviews the change
   and commits it. Do not commit for them unless they ask.
5. Tell the user that open sessions do not see the install: the block and the skills load when a
   session starts. A new session in any project now knows fuse.
6. For a custom Kiro agent, its `resources` must list the steering files and skills; `INSTALL.md`
   shows the lines. Offer to add them to the agent's file.

## 5. Harnesses without a preset

`install.sh` handles the five harnesses above. For another harness, find out from its documentation
which instruction files and skills folders it reads, then offer the measure that fits. Do each one
only with the user's yes, and remember that `install.sh --uninstall` does not undo these: tell the
user what you changed, and offer to write it down for them.

- **It reads a project's `AGENTS.md`.** Many do. A project install gives it the always-on block. If
  it supports agent skills, link its project skills folder to `.agents/skills`.
- **It has a user-level instruction file of its own.** `install.sh --global <that file>` accepts any
  file: it adds the block there and copies the skills into `skills/` next to it. If the harness
  reads skills from another folder, link that folder's entries to the copies.
- **It does not support agent skills.** Add one sentence to its instruction file, outside the
  fuse-konductor block: the skills are in `<folder>/<name>/SKILL.md`; when a task matches a skill's
  `description`, read that file and follow it.
- **Do not rely on `@path` imports** in an instruction file. Only Claude Code resolves them; other
  harnesses read them as plain text.
