---
name: about-konductor
description: 'Gets a new user from nothing to a working Konductor session: install the CLI, start the orchestrator, and describe real work in plain language. Covers the `konductor` commands, example prompts, and the agent/skill/SOP model. Use when a user asks "what is Konductor", "how do I install this", "what can I ask it", or "what''s the difference between an agent, a skill, and a SOP".'
version: 4.0.0
tags: [skill, help, onboarding, model, cli, install]
---

# About Konductor

Five steps from nothing to a working session: install the CLI, install the
agent content, start the orchestrator, give it real work, and — if you want
the one-paragraph version of how it all fits together — read the model.
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
`--harness` is required: say `kiro-cli-v2` or `kiro-v3` for Kiro CLI, or
`claude` for Claude Code. Install never guesses the harness from the
target's `.kiro` or `.claude` directory. Run `konductor doctor`
afterward to confirm everything registered — it inspects the install and
prints remediation guidance for anything wrong instead of a bare error.

See `cli/README.md` for the fully spelled-out walkthrough, prerequisites,
and installing into a directory other than `$HOME`. If `doctor` reports a
problem, a skill or SOP is missing after install, or the user asks about
another subcommand or flag, open `references/cli-and-model.md`.

## 3. Start a session

```bash
kiro-cli chat --agent konductor
```

On Claude Code, run `claude --agent konductor` instead.

That's the whole entry point. From here you never pick a
specialist agent, never pick a skill, never hunt for a SOP — you describe
what you want, and the orchestrator figures out what the task needs: which
SOP fits, which specialist agent or agents own it, which skills they apply.
That routing is the orchestrator's job, not yours.

Don't try to guess and invoke a specialist agent directly. The set of
installed agents, skills, and SOPs changes with every install and every
package update, so you don't need to know the fleet exists, name one, or
know how many there are ahead of time. Run `/prompts` (Kiro CLI) or `/help`
(Claude Code) any time you want to see what your own install actually has —
that's always current, unlike anything recalled from a prior session or
another install. For where each kind of content lands on disk, see
"Checking what's actually installed" in `references/cli-and-model.md`. If you're curious which one handles a particular kind of
work, ask the orchestrator — it will route you without you needing to look
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
multi-phase pass) — the orchestrator resolves that from the sentence itself
and verifies each specialist's output before moving on. You don't have to
know that structure to use it; naming an agent is optional, not required.

## 5. The model, in one paragraph

Konductor is one orchestrator, backed by SOPs (named multi-step procedures)
and specialist agents (each with their own skills — on-demand knowledge
modules). You never address the SOPs, agents, or skills directly: you
describe the outcome, the orchestrator picks the SOP if one fits, delegates
to the specialist agent that owns it, and that agent draws on its skills to
do the work.

Open `references/cli-and-model.md` (relative to this file) when the user asks
about a `konductor` subcommand or flag, a broken install, what is installed,
what the orchestrator can take on, or the agent, skill, and SOP model in more
detail than this paragraph.
