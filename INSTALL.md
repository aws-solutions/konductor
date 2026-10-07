# Installing fuse-konductor

fuse-konductor is a set of skills plus a short always-on instruction block. You install it from a
clone of the `fuse` branch with `install.sh`. It works with Claude Code, Codex, Cursor, OpenCode and
Kiro CLI.

You need a POSIX shell, `git`, coreutils and [Bun](https://bun.sh). The `persistent-memory` skill needs Bun, so `install.sh` refuses to install without it. The `fuse-flow` runner also runs on Bun. On Windows, use WSL.

You can also let an agent do all of this with you: clone the repository as in step 1, open an agent session in the clone, and say "Start the tutorial". It checks your harnesses and existing skills first, and installs only after you agree.

## 1. Clone the `fuse` branch

```bash
git clone -b fuse https://github.com/aws-solutions/konductor.git fuse-konductor
cd fuse-konductor
```

`main` is the default branch of this repository and holds konductor, not fuse-konductor, so always
name the branch.

## 2. Install

Choose one of two ways.

### Into one project

```bash
./install.sh --project /path/to/your/project
```

This copies every skill into `.agents/skills/` in the project, adds the always-on block to the
project's `AGENTS.md`, and links `.claude/skills` and `.kiro/skills` to `.agents/skills`. Commit
the result. Your teammates get the skills and rules with `git pull`, and you can edit them with the
rest of the project. This works for every supported harness, including Cursor.

The script also writes the path of your clone to `~/.konductor/fuse-konductor-clone`, one line
`clone=<path>` in your home directory, so the agent can find `fuse-flow` from any project. Each teammate runs
`install.sh --project` once from their own clone to write theirs; `--uninstall` leaves the file,
because other projects use it.

### For yourself, in every project

Pass the user-level instruction file of each harness you use:

```bash
./install.sh --global ~/.claude/CLAUDE.md             # Claude Code
./install.sh --global ~/.codex/AGENTS.md              # Codex
./install.sh --global ~/.config/opencode/AGENTS.md    # OpenCode
./install.sh --global ~/.kiro/steering/AGENTS.md      # Kiro CLI
```

You can list several files in one command. For each file, the script adds the always-on block and
copies the skills into `skills/` next to it (for Kiro CLI, into `~/.kiro/skills/`).

If you develop the skills yourself, add `--link`. The script then links each skill into your clone
instead of copying it, so edits to a skill in the clone are live at once. Running the command again
without `--link` turns the links back into copies.

Cursor has no user-level instruction file, so install it into a project instead.

## Custom Kiro agents

A custom Kiro agent loads steering files and skills only when its `resources` field lists them.
Add both:

```json
{
  "resources": [
    "file://~/.kiro/steering/**/*.md",
    "skill://~/.kiro/skills/*/SKILL.md"
  ]
}
```

For a project install, use `file://AGENTS.md` and `skill://.kiro/skills/*/SKILL.md` instead.

## Other harnesses

`install.sh` has presets for the five harnesses above. For another one, find out from its
documentation which instruction files and skills folders it reads, then pick what fits:

- **It reads a project's `AGENTS.md`,** as many do: a project install gives it the always-on block.
  If it supports agent skills, link its project skills folder to `.agents/skills`.
- **It has a user-level instruction file of its own:** `./install.sh --global <that file>` accepts
  any file. It adds the block there and copies the skills into `skills/` next to it. If the harness
  reads skills from another folder, link that folder's entries to the copies.
- **It does not support agent skills:** add one sentence to its instruction file, outside the
  fuse-konductor block: the skills are in `<folder>/<name>/SKILL.md`, and when a task matches a
  skill's `description`, read that file and follow it.

Do not rely on `@path` imports in an instruction file: only Claude Code resolves them, and other
harnesses read them as plain text. `--uninstall` does not undo links or sentences you add by hand.

## Update

```bash
cd fuse-konductor
git pull
./install.sh --project /path/to/your/project      # or the same --global command as before
```

Running the script again copies the new skills and updates the always-on block. With `--link`, the
pull alone updates the skills, but you still run the script for the block. With a project install,
you review the change with `git diff` before you commit it. A skill you edited in the project is kept and reported rather than replaced; delete it and run the script again to take the clone's version. Uninstall keeps edited skills too.

The script only changes what it installed. The always-on block sits between `<FUSE-KONDUCTOR>`
markers inside a `<GENERATED>` section, and everything else in the file stays as it is. A skill
with the same name that the script did not install is reported and skipped.

## Uninstall

Run the same command with `--uninstall`:

```bash
./install.sh --project /path/to/your/project --uninstall
./install.sh --global ~/.claude/CLAUDE.md --uninstall
```

## Customizing for your team

Fork the repository on GitHub. Clear "Copy the `main` branch only" when you create the fork,
otherwise the fork has no `fuse` branch. You can then make `fuse` the fork's default branch.

Clone your fork with `git clone -b fuse <your-fork-url>`, edit the skills in `skills/` and the
always-on block in `AGENTS.fuse.md`, and install from your clone as above. To take our updates,
pull from this repository's `fuse` branch and resolve conflicts with Git as usual.
