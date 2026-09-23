<!-- SPDX-License-Identifier: Apache-2.0 -->

# Appendix: contributing and customizing

[← Back to guide index](../README.md)

This appendix is for working **on** Konductor rather than with it: building the CLI from source,
changing how the agents behave, and contributing those changes back. Nothing here is needed to use
Konductor — if you just want the agents working, see [Quick Start](../quick-start.md).

---

## Contents

- [Customizing agent behaviour](#customizing-agent-behaviour)
- [Building the CLI from source](#building-the-cli-from-source)
- [Regenerating runtime files with `synth`](#regenerating-runtime-files-with-synth)
- [Validating your changes](#validating-your-changes)
- [Contributing changes back](#contributing-changes-back)

---

## Customizing agent behaviour

Everything Konductor does is plain JSON and Markdown in the repository. There is no compiled
behaviour, no database, no hidden state — so you can read exactly what an agent will do, and change
it.

Four files control four different things. Pick the smallest one that achieves what you want.

| Change | Edit | Effect |
| --- | --- | --- |
| Which specialist handles which kind of request | `context/k-orchestrator-routing-rules.md` | Routing, loaded at session start for all three orchestrators |
| The steps of one workflow | `agent-sops/<name>.sop.md` | That SOP's steps, constraints, and quality gates |
| How an agent reasons about one topic | `skills/<name>/SKILL.md` | Guidance that agent loads on demand |
| An agent's prompt, model, tools, or dependencies | `agents/<name>.agent-spec.json` | That agent, in both runtimes |

### Routing lives in two places

The routing rules file says so itself: `skills/delegation-protocol/SKILL.md` is the **authoritative**
source for routing, and the context file's table is a quick-reference summary. When they conflict,
the skill wins.

**Update both.** Changing only the context file leaves the authoritative source contradicting it.

### Adding a skill to an agent

A skill has to be named in **two** places or it will only load in one runtime — the dependency
list `konductor synth` reads for either harness, and the Claude Code skill list:

```json
{
  "dependencies": {
    "skills": {
      "skillNames": ["my-new-skill"]
    }
  },
  "clientConfig": {
    "claudeCli": {
      "skills": ["my-new-skill"]
    }
  }
}
```

There is no per-skill entry under `clientConfig.kiroCli.resources`. Kiro CLI reaches installed
skills through the bundled `skill-lookup` MCP server, not through its own `.kiro/skills/` scan —
see [Runtime differences that matter](../agents.md#runtime-differences-that-matter). The one
`skill://` resource each spec does carry is the `ws-*` glob for workspace skills.

Append to the existing arrays rather than replacing them. A skill directory that exists under
`skills/` but is declared by no agent cannot be loaded by anything — see
[Skills catalog → coverage](../skills.md#coverage) for the check that catches this.

### Writing a new skill

Create `skills/<kebab-case-name>/SKILL.md` with YAML frontmatter:

```yaml
---
name: my-new-skill
description: One line. This is what loads at session start, so it decides whether the agent reaches for the skill at all.
version: 1.0.0
tags: [skill, domain]
---
```

The `description` is load-bearing: only the name and description are in the agent's memory at session
start, so a vague description means the skill never gets loaded. Name it for the trigger, not the
implementation.

Skills may ship helper files alongside `SKILL.md` — scripts, evaluation fixtures, templates.

### Writing a new SOP

Create `agent-sops/<name>.sop.md` following the shape every existing SOP uses:

```text
# Title

## Overview          what it does, when to use it
## Parameters        required and optional, with defaults
## Steps
### 1. Step name
     description
     **Constraints:**      MUST / MUST NOT / SHOULD rules
     **Expected Output:**  what this step produces
## Quality Gate      (optional) the conditions for done
## Troubleshooting   (optional)
```

Use RFC 2119 wording deliberately — `MUST`, `MUST NOT`, `SHOULD`, `MAY`. It is how an agent tells a
hard rule from a preference, and it is why the existing SOPs behave consistently.

Then declare the SOP on whichever agents should be able to run it, in
`dependencies.agentSops.agentSopNames`. **A SOP is only available in a session with an agent that
declares it** — this is the single most common reason a new SOP appears to do nothing.

Check the delegation constraint too: if your SOP tells an agent to hand work to another agent, make
sure the owning agent is actually allowed to reach it. See
[Who can delegate to whom](../agents.md#who-can-delegate-to-whom).

---

## Building the CLI from source

You only need this to change the CLI itself. To use it, download a build — see
[Quick Start](../quick-start.md).

### Prerequisites

| Requirement | Check |
| --- | --- |
| Rust toolchain | `cargo --version` |
| Git | `git --version` |

Install Rust from [rust-lang.org/tools/install](https://www.rust-lang.org/tools/install) if `cargo`
is missing, then reopen your terminal.

### Build

```bash
git clone https://github.com/aws-solutions/konductor.git
```

The CLI crate lives at `cli/konductor-rs/` inside the repository:

```bash
cd konductor/cli/konductor-rs
```

```bash
cargo build --release
```

```text
    Finished `release` profile [optimized] target(s) in 6.44s
```

Anything ending in `Finished` succeeded.

### Run your build

```bash
./target/release/konductor --version
```

```text
konductor 1.0.0
```

To put it on your `PATH` for the current terminal session:

```bash
export PATH="$PWD/target/release:$PATH"
```

Or install it permanently to `~/.cargo/bin`:

```bash
cargo install --path .
```

If you also have a downloaded release build on your `PATH`, the two now collide under the same name
and whichever comes first wins. Keep one, and use `which konductor` when behaviour surprises you.

### Run the tests

```bash
cargo test
```

```text
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

### Checks before you open a pull request

```bash
cargo fmt --check
```

```bash
cargo clippy -- -D warnings
```

Clippy is configured to treat every warning as an error, so a clean run is required rather than
advisory.

---

## Regenerating runtime files with `synth`

`konductor synth` parses the source tree and writes runtime configuration from it. It is the command
you run after editing agents, skills, or SOPs.

```bash
konductor synth
```

Success prints nothing and exits `0`.

```bash
ls dist/kiro-cli-v2/agents
```

```text
k-architect.json
k-browser.json
konductor-cmux-orchestrator.json
k-developer.json
k-media-analyzer.json
konductor-mux-orchestrator.json
konductor.json
k-product-manager.json
k-quality-assurance.json
k-researcher.json
k-tpm.json
```

One file per agent spec. `dist/` is gitignored — it is generated output, never committed.

To synthesize a tree other than the current directory:

```bash
konductor synth --from /path/to/konductor
```

Output goes to `/path/to/konductor/dist/`, never your working directory.

### What `synth` reads

| Directory | Files | Rules |
| --- | --- | --- |
| `agents/` | `*.agent-spec.json` | Aborts on the first parse failure. Duplicate names rejected. |
| `skills/` | `<name>/SKILL.md` | Names must match `^[a-z0-9]+(-[a-z0-9]+)*$`. Files over 1 MiB rejected. |
| `agent-sops/` | `*.sop.md` | Duplicate names rejected. |

Each collection is sorted by name, so output is reproducible.

---

## Validating your changes

### `synth` is your fastest validator

It parses every agent spec, skill, and SOP and reports the first problem with a file and a reason:

```bash
konductor synth
```

```text
konductor synth: agents/k-developer.agent-spec.json: invalid JSON: key must be a string at line 1 column 3
```

Exit code `64`. Fix the named file and re-run.

**Silence alone does not prove your specs were checked** — a tree with no `agents/` directory exits
`0` and writes nothing. Confirm files appeared:

```bash
ls dist/kiro-cli-v2/agents/[a-z]*.json | wc -l
```

```text
      11
```

### Check skill coverage

Every skill directory should be declared by at least one agent, or nothing can load it:

```bash
ls skills | wc -l
```

```text
      82
```

Compare that against the union of every spec's declared skills. A mismatch means a skill exists that
no agent can reach — which matters most when a SOP instructs an agent to use it.

### Test your change end to end

Editing an agent, skill, or SOP has no effect on a running session — all three are read at session
start. Start a **new** session, then exercise the path you changed. For a SOP, ask the owning agent
for it by name and check the steps match what you wrote.

---

## Contributing changes back

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for the full process. In short:

1. Work against the latest source on the main branch.
2. Check existing and recently merged pull requests first.
3. Open an issue to discuss anything significant before writing it.
4. Fork, make a focused change, ensure local tests pass, commit with clear messages, and send a pull
   request.
5. Watch for automated CI failures and stay in the conversation.

### Conventions this repository expects

| Convention | Detail |
| --- | --- |
| Agent specs | JSON, 2-space indent. Append to arrays rather than reformatting the file. |
| Skills | Markdown with YAML frontmatter (`name`, `description` at minimum) |
| Agent names | `k-` prefix for specialists; `konductor` for the orchestrator |
| Skill names | Unprefixed unless avoiding a known collision |
| License headers | SPDX identifier as the first line — or line 2 for scripts needing a shebang |
| Portability | No organisation-specific references, internal tooling, or private domains |
| Usage errors | Exit `64`. Never exit `2` for a bad invocation. |
| Command surface changes | Keep `cli/README.md`'s command list in sync |

[CODE_OF_CONDUCT.md](../../../CODE_OF_CONDUCT.md) covers community standards.
[SECURITY.md](../../../SECURITY.md) covers reporting a vulnerability — do not open a public issue for
a security problem.

---

## Related

- [Agents reference](../agents.md) — every agent's model, tools, access, and delegation targets
- [Skills catalog](../skills.md) — all 82 skills and which agents declare each
- [SOP workflows](../sop-workflows/README.md) — the 19 procedures and their structure
- [CLI reference](../reference.md) — the full command, flag, config, and exit-code contract

---

[← Back to guide index](../README.md)
