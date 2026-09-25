---
name: about-konductor
description: Use when a user is new to Konductor or asks what it is, how to install it, what they can ask it, or how agents, skills, and SOPs differ, even if they only say "how do I get started". Walks from installing the `konductor` CLI to a first orchestrator session with example prompts.
version: 4.0.0
tags: [skill, help, onboarding, model, cli, install]
---

# About Konductor

Five steps from nothing to a working session: install the CLI, install the
agent content, start the orchestrator, give it real work, and, if you want
the one-paragraph version of how it all fits together, read the model.
Everything past that is detail you can come back to.

## 1. Install the CLI

```bash
git clone <this-repository's-URL>
cd <cloned-dir>
make build
make link
command -v konductor && konductor --version
```

Building from a local checkout is how you get the CLI onto your machine.

## 2. Install the agent content

```bash
konductor synth --from .
konductor install --from . --harness kiro-cli-v2
```

`synth` builds the pipeline/config artifacts from the repo root you cloned;
`install` copies them into a target (`$HOME` unless you pass `--target`).
`--harness` is required. Say `kiro-cli-v2` or `kiro-v3` for Kiro CLI, or
`claude` for Claude Code; there is no auto-detection. Run `konductor doctor`
afterward to confirm everything registered; it inspects the install and
prints remediation guidance for anything wrong instead of a bare error.

See `cli/README.md` for the fully spelled-out walkthrough, prerequisites,
and installing into a directory other than `$HOME`.

## 3. Start a session

```bash
kiro-cli chat --agent konductor
```

`konductor install` targets both Kiro CLI and Claude Code, but `--harness`
is required. It never auto-detects the runtime at the install target, so
you say `kiro-cli-v2`, `kiro-v3`, or `claude` explicitly and it installs the
matching agent/skill/SOP layout. On Claude Code, start the same orchestrator
through the `claude` CLI's own `--agent` flag instead of `kiro-cli chat
--agent`.

That's the whole entry point. From here you never pick a
specialist agent, never pick a skill, never hunt for a SOP. You describe
what you want, and the orchestrator figures out what the task needs: which
SOP fits, which specialist agent or agents own it, which skills they apply.
That routing is the orchestrator's job, not yours.

Don't try to guess and invoke a specialist agent directly. The set of
installed agents, skills, and SOPs changes with every install and every
package update, so you don't need to know the fleet exists, name one, or
know how many there are ahead of time. Run `/prompts` (Kiro CLI) or `/help`
(Claude Code) any time you want to see what your own install actually has.
That's always current, unlike anything recalled from a prior session or
another install. If you're curious which one handles a particular kind of
work, ask the orchestrator; it will route you without you needing to look
anything up yourself.

## 4. Give it real work

Once you're at the orchestrator's prompt, describe the outcome you want. No
special syntax, no need to name an agent:

```text
Design and implement a service that ingests IoT sensor events and alerts on anomalies.
```

```text
Review the API design in docs/api-design.md for security gaps before we build it.
```

```text
Write user stories for a self-service password reset flow.
```

```text
Our last deployment failed partway through — help me figure out why and fix it.
```

```text
Take this design doc and break it into implementation tasks two engineers can work on in parallel.
```

```text
Run a full pass on this feature — requirements through test coverage.
```

Each of these spans different specialist work under the hood (design,
security review, requirements, operations, task planning, or a full
multi-phase pass). The orchestrator resolves that from the sentence itself
and verifies each specialist's output before moving on. You don't have to
know that structure to use it; naming an agent is optional, not required.

## 5. The model, in one paragraph

Konductor is one orchestrator, backed by SOPs (named multi-step procedures)
and specialist agents (each with their own skills, on-demand knowledge
modules). You never address the SOPs, agents, or skills directly: you
describe the outcome, the orchestrator picks the SOP if one fits, delegates
to the specialist agent that owns it, and that agent draws on its skills to
do the work. Everything below this point is reference material for when you
want more than that one paragraph.

## What the orchestrator can take on

The orchestrator coordinates the full software development lifecycle: from
early requirements and design through implementation, testing, and
operational issues. It:

- Breaks a request into the phases and specialist work it actually needs,
  rather than requiring you to name a phase.
- Delegates each piece to whichever specialist handles it, and reviews the
  specialist's output before treating that piece as done.
- Chains multiple phases in one request when the ask spans more than one
  (e.g. "design and build" runs design review before implementation
  starts), or routes directly when the ask is narrow.
- Tracks a multi-step request as a checklist so you can see what's done,
  in progress, or blocked without re-explaining the task.

If a request needs something outside SDLC work entirely, or you're not sure
whether it's the right fit, just ask it. That's a routing question for the
orchestrator, not something to resolve yourself first.

## The `konductor` CLI

The CLI is a separate concern from the orchestrator above: it installs and
manages the framework on disk, rather than doing any SDLC work itself.
Naming its subcommands here is safe in a way naming agents/skills/SOPs is
not. The CLI's command surface is compiled into the binary you're running,
not part of an installable, changing content set. Verify against your own
build with `konductor --help` and `konductor <subcommand> --help`; flags and
defaults are the kind of detail that drifts across versions.

| Subcommand  | What it does                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`      | Create `.konductor/config.yml` in the current directory from a preset (`solo`, `team`, or `org`).                                                                                        |
| `install`   | Install Konductor into a target directory from a `--from <repo-root>` source. `--from` (source) and `--target` (destination) are distinct flags — don't conflate them.                   |
| `update`    | Re-run the same file-copy `install` uses against a tracked install, unconditionally overwriting every tracked file. No diffing, no `--force` flag, no protection for a hand-edited file. |
| `uninstall` | Remove a tracked install.                                                                                                                                                                |
| `synth`     | Synthesize pipeline/config artifacts from a repo root without installing anywhere.                                                                                                       |
| `doctor`    | Inspect an install or checkout and print remediation guidance for problems it finds.                                                                                                     |
| `metrics`   | Show usage/run metrics (still a stub as of this writing — verify with `--help`, don't assume it stayed one).                                                                             |

Every subcommand takes `-v`/`--verbose`, `--json`, and
`--no-color`; `install`, `update`, `uninstall`, and `doctor` also take
`--target` for the destination/tracked install to act on, and all but
`install` can act on one tracked target or `--all` of them at once. That
shape is stable enough to describe here; exact flag names, defaults, and
per-subcommand behavior are not; `konductor <subcommand> --help` is the
source of truth.

### Fixing a broken install

`konductor doctor` inspects a target (or `--all` tracked targets) and prints
actionable remediation guidance instead of a bare error. If a skill or SOP
you expect isn't showing up on a specific agent, that's usually a
registration gap rather than a missing file. A name has to be registered
on the exact agent that needs it, not just on a related one. Ask the
orchestrator to fix the registration; diagnosing which slot is missing is
an agent-spec-authoring task, not something this skill walks through.

## The agent / skill / SOP model, in more detail

Step 5 above is the one-paragraph version. Here's the fuller picture, for
when you want to understand _why_ the orchestrator behaves this way rather
than just knowing that it does.

Three kinds of content compose to make the orchestrator (and each
specialist) work:

- **Agent**: a persona with a system prompt, a model, and a fixed set of
  tool grants. One runs at a time as "the assistant" in a session.
- **Skill**: a reusable capability an agent loads on demand. Skills
  activate automatically when their description matches the task, or when
  explicitly requested by name.
- **SOP (Standard Operating Procedure)**: a named, parameterized,
  multi-step workflow an agent runs deliberately, not ambiently.

The practical difference: skills answer "what do you know how to do," SOPs
answer "run this specific procedure right now." You don't need to invoke
either directly. Describing the work to the orchestrator is what triggers
the right one.

Each agent spec is self-contained. This schema has no inheritance between
agent specs. An agent declares the skills it can load in
`dependencies.skills.skillNames` and the SOPs it can run in
`dependencies.agentSops.agentSopNames`, directly in its own file. A name has
to be registered on the exact agent that needs it; being a specialist under
the same orchestrator doesn't grant it automatically.

## Checking what's actually installed

The model above is stable; which agents and skills exist on a given install
is not. It changes every time one is added, renamed, or removed. Don't
recite a remembered list:

- **Agents:** `~/.kiro/agents/` (or `<target>/.kiro/agents/` for a
  `--target` install) is authoritative for what's installed. A remembered
  name will be wrong the moment an agent is added, renamed, or removed.
- **Skills:** installed under `.konductor/skills/`, not `.kiro/skills/`.
  They load automatically when their description matches the task, or when
  named explicitly in the conversation. There's no dedicated list command
  for skills specifically; on Claude Code an ordinary skill is also
  slash-invocable directly as `/<skill-name>`. If you're not sure one
  applies, ask the orchestrator.
- **SOPs:** `synth` builds runtime-native output into `dist/<harness>/sops/`
  (e.g. `dist/kiro-cli-v2/sops/`). On Kiro CLI, `install` copies each SOP
  verbatim into `.konductor/sops/`. Run `/prompts` to list every SOP your
  install has, then invoke a known one as `/agent-sop:<sop-name>`, not a
  bare `/<sop-name>`. On Claude Code, `install` converts each SOP into its
  own slash-invokable skill under `.claude/skills/sop-<name>/`. Run `/help`
  to list slash commands: SOPs appear there as `/sop-<name>`.

## Getting unstuck

- If you don't know which agent or skill fits a task, ask the orchestrator;
  it picks the specialist agent for you.
- If you don't know what SOPs are available, run `/prompts` (Kiro CLI) or
  `/help` (Claude Code) to see what your install actually has, or just
  describe the task and let the orchestrator route it.
- If the install or checkout looks broken, run `konductor doctor`.
- If something registered on one agent isn't showing up on another, that's
  the registration-per-agent rule above; ask the orchestrator to fix it.
