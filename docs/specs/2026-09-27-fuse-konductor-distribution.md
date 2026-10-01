Status: Implemented 2026-09-29; historical design record, superseded where current code and installation docs differ

# fuse-konductor distribution and installation

## Review summary

This spec replaces konductor's Rust installer with one shell script, `install.sh`, that a user
runs from a clone of the `fuse` branch. The script installs all skills and a small always-on
instruction block, either into one project repository or into the user's own harness config
files, for Claude Code, Codex, Cursor, OpenCode and Kiro CLI. The same workstream deletes the
Rust tool, the MCP server, the release pipeline and telemetry, and writes the install
instructions that start every customer engagement.

Beyond what was literally asked:

- **[added]** A small file, `.agents/skills/.fuse-konductor`, lists the skills a project install
  wrote. Copied skills have no symlink to trace, so without this list the script could not
  remove a skill that the source later dropped. Cost: one committed file per project.
- **[added]** Project mode creates `.claude/skills` and `.kiro/skills` as links to
  `.agents/skills`, because Claude Code and Kiro CLI do not read `.agents/skills/` in a project.
  Cost: two committed symlinks, which do not work on Windows without symlink support.
- **[added]** The always-on block has a size limit of 8 KiB, checked by a test. Codex limits all
  instruction files together to 32 KiB, and the block is loaded in every session.
- **[added]** The removal of the Rust tooling also updates the repository's own `Makefile`,
  `package.json`, `AGENTS.md` and `CLAUDE.md`, which describe building and running that tool.

This spec does not reduce the number of skills, support harnesses other than the five above,
offer a native Windows script, or publish through a plugin marketplace or `npx skills`.

## Decisions and assumptions requiring review

Owner decisions from review on 2026-09-28:

- The always-on block's source is the committed file `AGENTS.fuse.md` at the repository root,
  with no build step.
- Tests use Bun, the main TypeScript runtime and test runner. Tests that can also run on
  Node 22 or later are welcome, but Bun is required.
- Implementation follows TDD for the marker code and the ownership rules, not for the removal
  commits.
- This workstream ships a minimal `AGENTS.fuse.md`. The owner refines its content later.
- Every install copies the skills. `--global --link` links them into the clone instead, for
  machines where someone develops the skills. Running with or without `--link` converts the
  earlier install to the requested form. (Decided after the first implementation, which linked
  by default: the block already needs a rerun to update, so linking saved little and cost a
  second update path.)

Agent decisions, each easy to reverse:

- Implementation happens on `agents/defiant-claude-2`, in the current worktree.

Out of scope for this spec, owned by other workstreams:

- `fuse-flow` requires Bun at runtime. Making it available on the user's machine, and letting
  one repository run workstreams with different workflows, are handled in the fuse-flow
  workstream. The installer does not install Bun or `fuse-flow`.

Assumptions:

- Facts about where each harness reads files were checked in September 2026. They will drift.

## Scope boundary

### This iteration

- Remove the Rust tool, the MCP server, the release pipeline and telemetry, each in its own
  commit.
- Add `install.sh` with `--project`, `--global` and `--uninstall`.
- Keep the minimal `AGENTS.fuse.md` described in Decision 5 working with the script.
- Write the install instructions and remove the Rust-tool install sections from `README.md`.

### Deferred aspects summary

Skill reduction, a native Windows script, and support for more harnesses. See the ledger under
"Deferred aspects".

### Explicit non-goals

- Keeping or renaming the Rust command line tool. See Decision 1.
- A Claude Code or Codex plugin, and `npx skills`. Neither installs the always-on block, and we
  do not plan to use them.
- Per-harness synthesis. All supported harnesses read the same skills and `AGENTS.md`.
- Choosing a subset of skills at install time. A customer who wants fewer skills removes them
  from their fork.

## Risks and failure modes

- Windows. Requiring WSL may block a customer whose machines do not allow it. We accept this
  until a customer needs a native script.
- Skill descriptions use context. Every installed skill's name and description is loaded in
  every session, and all 79 count against the 32 KiB limit. The skill reduction workstream
  addresses this.
- Kiro custom agents. A user who runs a custom Kiro agent gets neither the block nor the skills
  unless the agent's `resources` field lists them. Decision 7 requires the instructions to say
  so.
- Editing a user's existing file is the one risky operation. The script reduces the risk by
  refusing unclear files and by reusing the DCP marker code. Acceptance criteria 6 to 8 and 10
  test it.
- Committed directory symlinks in project mode. `.claude/skills` and `.kiro/skills` are relative
  links in Git. A teammate on Windows without symlink support gets a plain text file instead.
- Harnesses change where they read files. The facts below are correct today and will go out of
  date. Checking them with a written procedure on each release is cheaper than trusting them.

## Acceptance criteria

1. The `fuse` branch contains no Rust command line tool, MCP server, release pipeline or
   telemetry, and each was removed in its own commit with passing tests.
2. `./install.sh` with neither `--project` nor `--global`, or with both, prints usage, exits
   with an error and writes nothing.
3. `./install.sh --project .` copies every skill into `.agents/skills/`, adds the block to
   `AGENTS.md`, links `.claude/skills` and `.kiro/skills`, and prints what it wrote.
4. `./install.sh --global ~/.claude/CLAUDE.md ~/.codex/AGENTS.md ~/.kiro/steering/AGENTS.md`
   adds the block to all three files and copies every skill into `~/.claude/skills/`,
   `~/.codex/skills/` and `~/.kiro/skills/`. With `--link`, it links every skill into the clone
   instead. A later run with or without `--link` converts the skills it installed to that form,
   and leaves every other entry alone.
5. A second run with the same arguments changes nothing.
6. A file with a `<FUSE-KONDUCTOR>` section is byte for byte the same outside that section before
   and after, including files with CRLF line endings and files without a final newline.
7. A file that already has a DCP or DCL section keeps it unchanged, and both sections sit in one
   `<GENERATED>` pair.
8. A file with malformed or unclear markers is reported and not changed.
9. After a skill is removed from the source, the next run removes it from the target. No skill
   the script did not install is ever changed or removed.
10. `--uninstall` with the same arguments leaves no fuse-konductor skill and no
    `<FUSE-KONDUCTOR>` section. Every file that existed before the install is byte for byte the
    same as before.
11. `AGENTS.fuse.md` is under 8 KiB, checked by a test.
12. A clone of a fork with a different owner and repository name installs its own content without
    edits to any file.
13. `README.md` no longer describes installing with the Rust tool. The install instructions, in
    `README.md` or `INSTALL.md`, cover everything listed in Decision 7, and following them from a
    fresh machine with only the link produces a working install.

## Install workflow

These steps are the same for the public repository and a customer fork.

1. Clone the `fuse` branch: `git clone -b fuse https://github.com/aws-solutions/konductor.git`.
2. Run `./install.sh --project <dir>` or `./install.sh --global <file> ...`.
3. To take updates, run `git pull` and then the script again.

A customer who forks edits skills and the block source in their clone. With a global install,
every harness sees skill edits at once. With a project install, they run the script again to
copy the edits into the project. To take our updates, they pull from upstream and resolve
conflicts with normal Git. A binary installer cannot support this loop, which is the reason for
Decision 1.

## Implementation detail

### Supported harnesses

- Claude Code
- Codex
- Cursor
- OpenCode
- Kiro CLI

Other harnesses are not targeted. The script needs no code for them.

### Context

The owner decided the following on 2026-09-27 and 2026-09-28:

- An always-on instruction block is required. konductor put it in an agent spec's system prompt.
  fuse-konductor must put it in each harness's own always-on file.
- fuse-konductor lives permanently on the `fuse` branch of `aws-solutions/konductor`. konductor
  stays on `main`, which remains the default branch. `tbelmega/semikonductor` is a temporary
  fork used until then.
- Distribution is public. The Fuse team works on customer sites. We install fuse-konductor on
  customer development machines, or help a customer fork the repository, change it, and install
  their fork. Customers may use different harnesses.
- Skills keep their konductor names. This makes pull requests back into konductor and merges
  from upstream easier.

The following facts about the supported harnesses were checked and drive the decisions below:

- All of them read `AGENTS.md` at the project root.
- In a project, Claude Code reads skills only from `.claude/skills/` and Kiro CLI only from
  `.kiro/skills/`. Codex, Cursor and OpenCode read `.agents/skills/`.
- Cursor has no user-level instruction file. It stores user rules in its application settings,
  and its command line tool does not read them.
- Kiro CLI reads user-level instructions from any Markdown file in `~/.kiro/steering/`, and
  user-level skills from `~/.kiro/skills/`. Custom Kiro agents load neither unless the agent's
  `resources` field lists them.
- Only Claude Code resolves `@path` imports inside an instruction file. The others treat the
  line as plain text.
- Codex limits all instruction files together to 32 KiB.

The following facts about the repository and related tools were checked:

- The content is 79 skills in `skills/<name>/SKILL.md`. SOPs are still present as
  `agent-sops/*.sop.md`.
- The existing command line tool is about 87,000 lines of Rust. It has a release pipeline for
  several platforms with checksums, telemetry, an install manifest, a prune step and
  per-harness synthesis.
- The repository's `README.md`, `AGENTS.md`, `CLAUDE.md` and `Makefile` describe building and
  installing with that tool.
- DCP and DCL share one marker format. Each file gets one outer `<GENERATED>` ... `</GENERATED>`
  pair, and each tool writes its own inner section inside it, such as
  `<DECENTLY-CAPABLE-POWERS>` ... `</DECENTLY-CAPABLE-POWERS>`. A marker counts only when it is
  the whole line, after trimming spaces. If the markers in a file are malformed or unclear, the
  file is reported and left alone.

### Decision 1: no Rust command line tool

The main reason is customer forks. With a binary installer, each fork needs its own Rust
toolchain, its own tagged releases, and its own binaries and checksum files for every platform.
Only then does a changed skill reach the engineer who changed it. With a clone and a script, the
change reaches a machine when the script runs again, or at once with `--link`. `docs/installation/README.md` explains this in full.

Other reasons:

- The tool existed mainly to do per-harness synthesis, and that step is being removed. Little
  else in it is needed.
- Adapting it for fuse-konductor means renaming it throughout: the crate and binary name, the
  `~/.local/bin/konductor` link, the `$HOME/.konductor/bin-links` file, the `.konductor` config
  directory, the `konductor-skills` MCP server name, the telemetry identity, the release asset
  names, the bootstrap scripts, the committed `dist/` tarball, and every test that checks any of
  these.
- On a customer machine, a script that engineers can read is easier to get through a security
  review than a downloaded binary.

### Decision 2: remove the Rust tooling from the `fuse` branch

This workstream deletes the Rust command line tool, the MCP server, the release pipeline and
telemetry from the `fuse` branch. On a customer machine they are unused code that a security
review still has to read, and after this change the repository is what it now is: a skills
repository.

Each removal is its own self-contained commit, made before the installer is added:

1. Remove telemetry.
2. Remove the MCP server.
3. Remove the release pipeline, the bootstrap scripts, their tests and the committed `dist/`
   tarball.
4. Remove the Rust command line tool and its tests.

Each commit also updates whatever refers to the removed part: `Makefile` targets,
`package.json` scripts, and the build and install instructions in the repository's `AGENTS.md`
and `CLAUDE.md`. After each commit, the remaining tests pass. If one part depends on another,
for example the command line tool starting the MCP server, the order changes so that no commit
leaves broken references. Nothing outside these parts is changed in the same commits.

### Decision 3: one POSIX shell script in the repository

`install.sh` sits at the repository root and runs from a clone. It finds the repository from its
own location, not from a hardcoded name, so a fork installs its own content without edits. It
needs only a POSIX shell, `git` and coreutils. It needs no network access beyond the clone, no
Node, no npm registry and no downloaded binary. It sends no telemetry.

DCL and DCP work the same way, for the same reason: the repository is where the content is
written and changed, so the clone is the source of truth.

Every install includes all skills in the clone. A customer who wants fewer skills removes them
from their fork.

On Windows the script requires WSL. If `--link` cannot create a symlink, the script copies the
skill instead and says so. A native PowerShell script is not planned until a customer needs one.

### Decision 4: script arguments

```
install.sh --project <dir>                     [--uninstall]
install.sh --global <file> [<file> ...] [--link] [--uninstall]
```

Exactly one of `--project` or `--global` is required. With neither, or both, the script prints
usage and exits with an error. It never guesses a target.

#### `--project <dir>`

Installs fuse-konductor into one project. `<dir>` can be `.`.

- Copies each skill to `<dir>/.agents/skills/<name>/`.
- Adds the always-on block to `<dir>/AGENTS.md`, creating the file if it does not exist.
- Creates `<dir>/.claude/skills` and `<dir>/.kiro/skills` as relative symlinks to
  `../.agents/skills`, for Claude Code and Kiro CLI. If either path already exists as a real
  directory, the script links each skill into it one by one instead.

Skills are copied, not linked, because the project commits them. One person runs the script,
commits the result, and the rest of the team gets the skills and rules with `git pull`. The team
can then edit them together with the project source. This suits a user or a company that wants
to try fuse-konductor in one project.

#### `--global <file> ...`

Installs fuse-konductor for the current user, once per listed file. Each file is a harness's
user-level instruction file. For each file, the script:

- adds the always-on block to the file, creating the file if it does not exist, and
- copies each skill into `skills/` next to the file. If the file's directory is named
  `steering`, the script uses `skills/` next to that directory instead. This covers Kiro CLI.

To take updates, the user runs `git pull` in the clone and then the script again. This is the
same for the skills and the block, and the same as for a project install.

Files for the supported harnesses:

| Harness | File | Skills directory |
| --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` |
| Codex | `~/.codex/AGENTS.md` | `~/.codex/skills/` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` |
| Kiro CLI | `~/.kiro/steering/AGENTS.md` | `~/.kiro/skills/` |

Cursor has no user-level file, so it is supported only with `--project`.

#### `--link`

Only with `--global`, and not with `--uninstall`. The script links each skill into the clone
instead of copying it, so edits to a skill in the clone are live at once. This is for machines
where someone develops the skills. The block is still a copy and updates only when the script
runs again.

The script converts what it installed earlier: a run with `--link` replaces its own copies with
links, and a run without `--link` replaces its own links with copies. It never converts an
entry it did not install. `--uninstall` removes both forms.

#### `--uninstall`

Reverses an install for the same target. It takes the same `--project` or `--global` arguments,
because the script keeps no global record of where it installed. It is a flag on `install.sh`,
not a separate script: both actions parse the same arguments, use the same marker code, and
must stay in step, and a second script would duplicate that code.

### Decision 5: the always-on block always sits between markers

The always-on content is the committed file `AGENTS.fuse.md` at the repository root. It contains
no `@` imports and no references to other files, because only Claude Code follows them.

The minimal first version tells the agent to:

- use a fuse-konductor workflow when the user asks for konductor or fuse, and to suggest one,
  without insisting, when the user starts a new feature, system or other large piece of work, or
  asks to continue work in progress;
- check `.konductor/workstreams/` for a workstream in progress before starting a new one;
- offer the installed workflows, and recommend one when it knows enough, starting only after the
  user agrees;
- run the `fuse-flow` loop: `start`, then the step's skill and instruction, and `continue`,
  until the workflow is complete, stopping at owner gates.

The owner refines this content later. The installer copies the block as it is, without
changing its text.

The script always writes the block between markers, even in a file it creates itself. Users
edit their instruction files, and other tools such as DCP and DCL write their own blocks into
the same files. The markers keep each part separate. The script uses the DCP and DCL format:

```
<GENERATED>
<FUSE-KONDUCTOR>
...fuse-konductor content...
</FUSE-KONDUCTOR>
<DECENTLY-CAPABLE-POWERS>
...DCP content...
</DECENTLY-CAPABLE-POWERS>
</GENERATED>
```

Rules:

- If the file has no `<GENERATED>` pair, the script appends one at the end of the file.
- If it has one, the script replaces the `<FUSE-KONDUCTOR>` section inside it, or adds the
  section if it is missing. Other sections stay as they are.
- Everything outside the `<FUSE-KONDUCTOR>` section stays byte for byte the same, including line
  endings and a missing final newline.
- If the markers are malformed or unclear, the script reports the file and does not change it.
- On uninstall, the script removes the `<FUSE-KONDUCTOR>` section. If the `<GENERATED>` pair is
  then empty, it removes the pair too. If the file is then empty and the script created it, it
  deletes the file.

This is the only hard part of the script. The DCP implementation in
`/home/tbelmega/skills/decently-capable-powers/install.sh` already solves it and should be
reused.

### Decision 6: the block has a size limit

Codex limits all instruction files together to 32 KiB, and the customer's own files count toward
that limit. The block is also loaded in every session on every harness, which is what made
konductor's long agent-spec prompts expensive.

The target is 4 KiB. The limit is 8 KiB, checked by a test. The block holds only rules that must
never be missed, plus a table that says which skill to load for which kind of work. Everything
else goes in a skill. If the block grows past the limit, move content into a skill instead of
raising the limit.

### Decision 7: install instructions

This workstream writes the install instructions and replaces the tool-based install sections of
`README.md`. If the instructions are short, they go in `README.md`. If they are too long, they go
in `INSTALL.md` at the repository root, and `README.md` links to it.

A customer engagement starts with a link to that file on the `fuse` branch. So the instructions
must work for a reader who has nothing but that link:

- They name the branch in every clone command: `git clone -b fuse ...`.
- They show both install modes, with one example command per supported harness for `--global`.
- They explain update and uninstall.
- They tell a customer who forks on GitHub to clear "Copy the `main` branch only", because
  otherwise the fork has no `fuse` branch.
- They say that custom Kiro agents need the steering and skills paths in their `resources` field.

### Update and ownership

Global install: each copied skill holds a small file, `.fuse-konductor-copy`, that names the
clone it came from. A copy marked with this clone, or a link that points into this clone (from
`--link`), belongs to fuse-konductor. No other record is needed.

Project install: copies have no link to follow, so the script writes the names of the skills it
installed to `<dir>/.agents/skills/.fuse-konductor`. The project commits this file with the
skills.

- Update: run `git pull` in the clone, then run the script again with the same arguments. The
  run replaces the copied skills and the block. With `--link`, the pull alone updates the
  skills. For a project install, the change shows up in the project's `git diff` for review
  before commit.
- Removed skills: on each run, the script removes skills that it installed earlier and that the
  source no longer has. For a global install, these are marked copies or links into the clone
  whose skill is gone. For a project install, these are names in `.fuse-konductor` that the
  source no longer has.
- Existing skills: the script never overwrites or removes a skill directory it did not install.
  If a skill with the same name already exists, it reports the conflict and skips that skill.
- Broken links: a link whose target cannot be resolved may point to another checkout on a drive
  that is not mounted. The script deletes a link only if it points into this clone and the target
  is known to be missing. It never follows a parent directory that is itself a symlink when
  deleting.

### Testing

Tests for `install.sh` run the real script against temporary home and project directories and
check the resulting files. They cover every acceptance criterion from 2 to 12. They run with
`bun test`, like the fuse-flow tests. They may also run on Node 22 or later, but Bun is the
supported runner.

## Deferred aspects

- Skill reduction. Why: a separate workstream that starts soon. Returns: when that workstream
  starts. Fit: it changes only the content of `skills/`; the script installs whatever is there.
- Native Windows script. Why: WSL covers Windows for now. Returns: when a customer cannot use
  WSL. Fit: a PowerShell script with the same arguments and the same marker rules.
- More harnesses, including Gemini CLI. Why: not among the most popular, and Gemini CLI reads
  `GEMINI.md` rather than `AGENTS.md` by default. Returns: when a customer uses one. Fit: a new
  row in the `--global` table; `--global` already accepts any file path.

## Implementation guidance

- TDD: yes for the marker code and the ownership rules (Decisions 4 and 5, "Update and
  ownership"); no for the removal commits in Decision 2. Owner decision.
- Isolation: current checkout, branch `agents/defiant-claude-2` (agent decision).
- Verify: `bun test` for the installer tests and in `fuse/flow`, plus `npm test` and
  `python -m pytest tests` for the remaining tests, before claiming any task done. After
  Decision 2, `make test` must no longer run Rust tests.
- Review: once, after all tasks are complete and final verification passes, using the DCL
  bundled reviewer (`review.reviewer` is `codex` in `/home/tbelmega/workplace/tracker/loops.json`)
  per the loops-review skill. Its terminal signal is `REVIEW_STATUS=passed` for the current HEAD,
  with a clean tree.
- Scope: build only what this spec specifies; propose extras, don't build them.
- Deferred aspects: the ledger above was reconciled at finalization. No tracker entry is
  required by project instructions.
- Build order:
  1. The four removal commits from Decision 2, in the order given, adjusted for dependencies.
  2. The marker code, ported from DCP, with its tests first, because it is the riskiest part.
  3. `--global`, then `--project`, then `--uninstall`.
  4. The size test for `AGENTS.fuse.md`.
  5. Install instructions and the `README.md` update.
- Routing: the removal commits are mechanical and can be delegated one at a time at medium
  effort, reviewed by the orchestrator before each commit. The marker code and the script's
  ownership rules stay with the orchestrator at high effort. The install instructions stay with
  the orchestrator, because they must match the final behavior exactly.
- Orchestrator: a top-tier model at high effort. A fresh session can implement from this spec
  alone.
