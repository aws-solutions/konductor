<!-- SPDX-License-Identifier: Apache-2.0 -->

# Troubleshooting

[← Back to guide index](README.md)

Specific symptoms, in symptom → cause → fix form.

Before working through these, run the built-in check — it catches most installation problems and tells
you the fix:

```bash
konductor doctor
```

For a systematic walk-through rather than a specific symptom, see
[Diagnose problems](tasks/diagnose-problems.md).

---

## Contents

1. [`konductor: command not found`](#1-konductor-command-not-found)
2. [A command exits `64`](#2-a-command-exits-64)
3. [The orchestrator does the work itself instead of delegating](#3-the-orchestrator-does-the-work-itself-instead-of-delegating)
4. [Claude Code specialists spawn but do nothing](#4-claude-code-specialists-spawn-but-do-nothing)
5. [An agent says it cannot run a workflow](#5-an-agent-says-it-cannot-run-a-workflow)
6. [My edits to an agent, skill, or SOP had no effect](#6-my-edits-to-an-agent-skill-or-sop-had-no-effect)
7. [`konductor synth` succeeds but produces nothing](#7-konductor-synth-succeeds-but-produces-nothing)
8. [A config value is not what I set](#8-a-config-value-is-not-what-i-set)

---

## 1. `konductor: command not found`

**Symptom.**

```bash
konductor --version
```

```text
zsh: command not found: konductor
```

**Cause.** The binary is not on your `PATH`. Usually one of:

1. It was downloaded but never moved anywhere on the `PATH`.
2. It was moved to `~/.local/bin`, but that directory is not on your `PATH`.
3. You added a directory to `PATH` with `export` in a *different* terminal session — `export` does not
   persist across sessions.

**Fix.** Check whether the binary exists where you put it:

```bash
ls ~/.local/bin/konductor
```

If it is missing, rebuild and re-link it from your clone:

```bash
make -C <repo-root> build
make -C <repo-root> link
```

If the binary exists but is still not found, `~/.local/bin` is not on your `PATH`. Add it in your
shell profile:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

Then open a new terminal, or `source ~/.zshrc`. Use `~/.bashrc` if you use bash.

Confirm which binary you are running:

```bash
which konductor
```

```text
/Users/you/.local/bin/konductor
```

---

## 2. A command exits `64`

**Symptom.** A command prints an error and your shell reports exit status `64` — an unfamiliar number
if you are used to `1` or `2`.

```bash
konductor instal
```

```text
error: unrecognized subcommand 'instal'

  tip: some similar subcommands exist: 'init', 'uninstall', 'install'

Usage: konductor [OPTIONS] [COMMAND]

For more information, try '--help'.
```

Or:

```bash
konductor --bogus
```

```text
error: unexpected argument '--bogus' found

Usage: konductor [OPTIONS] [COMMAND]

For more information, try '--help'.
```

**Cause.** `64` is `EX_USAGE` from BSD `sysexits.h` — the CLI's code for *you typed something wrong*.
It is deliberately not `2`, so that a malformed invocation can never be confused with a substantive
failure.

**Fix.** Read the message and correct the invocation. When the subcommand is unrecognized, the `tip:`
line names the closest real commands.

```bash
konductor --help
```

Everything that exits `64` is listed in
[CLI reference → exit-code contract](reference.md#everything-that-exits-64). Note that a failed
`konductor doctor` check is **not** a usage error — it exits `1`. A `64` from `doctor` always
means the invocation itself was malformed.

---

## 3. The orchestrator does the work itself instead of delegating

**Symptom.** You asked `konductor` to implement something and it started editing files and
running shell commands directly, rather than handing off to `k-developer`.

**Cause.** The orchestrator is supposed to be read-only. That rule lives in
`context/k-orchestrator-routing-rules.md`, loaded at session start. If the context file did not
load, the behaviour is gone — the system prompt alone does not carry it.

The rule itself:

> **NEVER MUTATE DIRECTLY — DELEGATE INSTEAD.** You are a read-only orchestrator. You NEVER directly
> execute mutating operations or shell commands. […] Note: `shell` must always be delegated even for
> apparently read-only commands (e.g., `ls`, `grep`) — there is no read-only carve-out for shell.

**Fix.**

1. Confirm the content is registered:

```bash
konductor doctor
```

Look at the `context files` line — it should report `1 registered`.

2. If it reports `0`, reinstall and start a **new** session. Context files are read at session start,
   so an in-flight session keeps the old state.

```bash
konductor install --harness kiro-cli-v2
```

3. Confirm you actually started an orchestrator. Only the three orchestrators load this file;
   `k-developer` is *supposed* to write files, so if you invoked it directly this is correct
   behaviour rather than a bug.

**A related symptom with the same cause:** the orchestrator saying "I can't access X" or "I don't have
the ability to…". The routing rules explicitly forbid that response — the correct behaviour is to
check the routing table and delegate to a specialist that can. Hearing "I can't" is a strong signal
the routing rules did not load.

---

## 4. Claude Code specialists spawn but do nothing

**Symptom.** The orchestrator spawns a specialist. It appears, then accomplishes nothing — no error,
no permission prompt, no output.

**Cause.** Missing tool permissions. Background subagents **cannot prompt you interactively**, so any
tool not in `permissions.allow` in `~/.claude/settings.json` is **silently auto-denied**. The
specialist has no tools and no way to tell you.

The mirror-image failure has the same silence: with `permissions.allow` configured but
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset, specialists never spawn at all. Both settings are
required.

**Fix.**

```bash
konductor doctor
```

`doctor` will **not** catch either of them. Its `runtime` check reports which runtime it
detects at the target and nothing more — `cli/README.md` is explicit that `doctor` "does not
check Claude Code-specific environment state". Verify both settings by hand:

```bash
claude settings get env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
grep -A5 '"permissions"' ~/.claude/settings.json
```

Apply what it tells you, then start a **new** session — both settings are read at startup. The full
allowlist to paste is in
[Install for Claude Code](tasks/install-claude-code.md#3-grant-tool-permissions).

**Diagnosis shortcut:** specialists spawning but idle → permissions. Specialists never spawning →
environment variable.

---

## 5. An agent says it cannot run a workflow

**Symptom.** You asked an agent for a workflow by name and it says it does not have it, or it
improvises something different.

**Cause.** **A SOP is only available in a session with an agent that declares it.** For example
`k-test-coverage-review` is declared only by `k-quality-assurance` — ask
`k-product-manager` for it and there is nothing to run.

**Fix.** Either start with `konductor` and let it route:

```text
Run the k-test-coverage-review SOP on src/ against test/.
```

Or go directly to the owning agent. The ownership table is in
[SOP workflows → which agent owns which SOP](sop-workflows/README.md#which-agent-owns-which-sop).

**A related case:** a workflow that tells one agent to hand off to another may find it is not allowed
to. Delegation is scoped per agent — `k-developer` can reach `k-quality-assurance` but not
`k-architect`, for instance. See
[Who can delegate to whom](agents.md#who-can-delegate-to-whom). Where that affects a specific
workflow, the SOP page says so.

---

## 6. My edits to an agent, skill, or SOP had no effect

**Symptom.** You changed a skill or a SOP, asked the agent to do the thing, and got the old behaviour.

**Cause.** Two possibilities, and both are easy to hit:

1. **Agents, skills, and context files are read at session start.** A running session keeps what it
   loaded.
2. **You edited the source tree, but the runtime reads the installed copy.** Editing
   `skills/foo/SKILL.md` in a clone does not change what your runtime loaded.

**Fix.** Regenerate and reinstall, then start a new session:

```bash
konductor synth
```

```bash
konductor install --harness kiro-cli-v2
```

Start a new runtime session and try again.

Your edits will **not** survive the next `konductor update` — it overwrites every tracked file
unconditionally. Keep them in version control, and run `konductor update --dry-run` first to see
which files would be clobbered. See
[Contributing and customizing](appendix/contributing.md#validating-your-changes).

---

## 7. `konductor synth` succeeds but produces nothing

**Symptom.** `synth` exits `0` and prints nothing, but there is no `dist/` directory.

```bash
konductor synth
```

**Cause.** Most likely you ran it somewhere without an `agents/` directory. `synth` reads `agents/`,
`skills/`, and `agent-sops/` relative to the source tree. A tree with none of them parses to an empty
model, writes zero files, and exits `0` — silently.

Silence is also what success looks like, which is what makes this confusing: **`synth` printing
nothing tells you nothing.** Check for files instead.

**Fix.** Confirm you are in a tree with the content:

```bash
ls agents
```

You should see 11 `*.agent-spec.json` files. Then re-run and verify output appeared:

```bash
ls dist/kiro-cli-v2/agents/[a-z]*.json | wc -l
```

```text
      11
```

Or point at the tree explicitly — remembering output lands in `<that path>/dist/`, not your current
directory:

```bash
konductor synth --from /path/to/konductor
```

**If a spec is malformed instead**, you get a specific error and exit `64`, not silence:

```text
konductor synth: agents/broken.agent-spec.json: invalid JSON: key must be a string at line 1 column 3
```

Fix the named file and re-run.

---

## 8. A config value is not what I set

**Symptom.** A finding severity or change tier is not what your project config says.

**Cause.** Three layers merge — CLI defaults, then `~/.konductor/config.yml`, then the project file —
and a forgotten **user-level** config applies to every project while nothing surfaces it.

**Fix.** Check the user layer:

```bash
cat ~/.konductor/config.yml
```

`No such file or directory` means you have no user-level config, and the value is coming from the CLI
defaults. Otherwise, that file is your answer — edit or remove it.

To override just for this project, edit `.konductor/config.yml` directly — project config
always wins over the user layer. Full precedence rules are in the
[CLI reference](reference.md#configuration-file).

---

## Still stuck?

- [Diagnose problems](tasks/diagnose-problems.md) — the systematic sequence, including reading
  `~/.konductor/logs/konductor.log`
- [FAQ](faq.md)
- [CLI reference](reference.md) — the exact command, flag, config, and exit-code contract
- [Getting help](getting-help.md)

---

[← CLI reference](reference.md) · [Back to guide index](README.md) · [Next: FAQ →](faq.md)
