# Kiro Crew Integration (Optional)

[Kiro Crew](https://kiro.dev/crew/) is an open source, persistent development workspace from the Kiro team. It runs on top of Kiro CLI and drives it over the Agent Client Protocol (ACP), the same protocol Kiro CLI itself uses. A plain Kiro CLI or Kiro IDE session ends when you close it. Crew adds memory across sessions, cron and webhook scheduling, and a dashboard, full CLI, and Slack/Telegram/Discord front ends on top of that same session model.

Crew's own docs state that your existing `.kiro` configuration, including steering files, skills, and custom agents, carries over automatically. konductor's Kiro CLI install already places its agent spec at `~/.kiro/agents/konductor.json`, the standard location for a Kiro custom agent. That means konductor works inside Crew with no extra integration step: once it's installed for Kiro CLI, Crew already sees it.

This guide is Kiro CLI only. Crew has no Claude Code equivalent, and it requires signing in with a Kiro account.

## Prerequisites

- konductor installed for Kiro CLI: see the [Quick Start](../../README.md#quick-start), building from source with `konductor synth` / `konductor install`
- A working `kiro-cli chat --agent konductor` session, confirmed before adding Crew on top
- Kiro Crew installed and a Kiro account signed in

## Install Kiro Crew

```bash
curl -fsSL https://download.crew.kiro.dev/cli.sh | sh
kirocrew setup
kirocrew doctor
```

`kirocrew setup` walks through Kiro account sign-in and initial configuration. `kirocrew doctor` checks prerequisites and connectivity; every check should pass before you continue.

## Set konductor as the default agent (optional)

Kiro CLI has a `chat.defaultAgent` setting that names which agent a new session opens with, so you don't need `--agent konductor` on every invocation (confirm the setting name against `kiro-cli settings --help` on your installed version, since this guide doesn't have a stable doc link to cite):

```bash
kiro-cli settings chat.defaultAgent "konductor"
```

This writes to `~/.kiro/settings/cli.json`. konductor's installer doesn't set this for you; it's a manual step.

Crew's own docs say it inherits `.kiro` configuration wholesale and drives the same `kiro-cli` process over ACP, so a `kirocrew chat` session should pick up this same setting. No source explicitly states that Crew's ACP session path reads `chat.defaultAgent`, though; that's an inference from Crew's "inherits .kiro config" claim, not a quoted guarantee. Verify it against your installed version before relying on it.

## Start a konductor session in Crew

```bash
kirocrew chat
```

Select `konductor` as the session's active agent the same way you would with `kiro-cli chat --agent konductor`. Run `kirocrew chat --help` on your installed version to confirm the current flag for choosing a named agent; see Gaps below for why this guide can't hand you the exact syntax.

Once a konductor session is running inside Crew, everything in the main [Quick Start](../../README.md#quick-start) and [Usage Examples](../../README.md#usage-examples) applies unchanged: delegate to `k-architect`, `k-developer`, `k-quality-assurance`, and the rest of the specialist roster, or run an Agent SOP with `/agent-sop:k-full-sdlc`.

## What Crew adds on top

- **Persistent memory across sessions.** Crew's own memory layer, separate from konductor's `persistent-memory` skill and `.konductor/memory/` scratchpad, carries corrections and context forward between chats.
- **Scheduling.** `kirocrew cron` and webhook triggers can start a konductor session unattended, for example a nightly `k-full-sdlc` run against a fixed project description.
- **Background runs.** `kirocrew spawn` starts a subagent task from the terminal without an interactive session.
- **An App SDK** (`@kirocrew/app-sdk`, TypeScript or Python) for wrapping a konductor-driven workflow in a dedicated UI. Apps are defined with `defineApp` and `useAgent`, with fields such as `skills` (a Crew skill file), `schedule` (a cron string), and `ui` (a render function). This is for teams building a purpose-built dashboard on top of a workflow, not a replacement for Crew's own chat interface.

## Gaps to verify yourself

- **No documented flag for selecting a named agent in `kirocrew chat`, but a likely workaround exists.** Kiro Crew's product page and GitHub README don't spell out a per-invocation flag for choosing a custom agent, as of this writing. Kiro CLI does have a documented `chat.defaultAgent` setting (see [Set konductor as the default agent](#set-konductor-as-the-default-agent-optional) above), persisted to `~/.kiro/settings/cli.json`, and Crew's own docs say it inherits `.kiro` configuration wholesale while driving the same `kiro-cli` process over ACP. That's a strong signal a `kirocrew chat` session reads the same setting, but no source explicitly confirms it for Crew's ACP session path, so treat it as inference, not a confirmed guarantee, until you've verified it. Confirm with `kirocrew chat --help` before scripting against either approach.
- **Skill directory placement.** konductor deliberately installs its skills under `~/.konductor/skills/<name>/`, not `~/.kiro/skills/`, specifically so Kiro CLI's blanket skill discovery doesn't expose every skill to every agent (see [How installing Konductor works](../../README.md#how-installing-konductor-works)). Crew's "skills carry over automatically" claim is about `.kiro` configuration; whether it independently rescans `~/.konductor/skills/` isn't confirmed by Crew's own docs. This shouldn't matter in practice, since Crew drives the same kiro-cli process that already resolves those skill paths in a plain session, but that's an inference, not a documented guarantee from Crew itself.
- **No published konductor release yet.** Per the [Quick Start](../../README.md#quick-start), there's no released `konductor` binary, and the public repo hasn't shipped. Building from source is the only way to get konductor running today, independent of Crew.

## Reference

- Kiro Crew: <https://kiro.dev/crew/>
- Kiro Crew source and CLI: <https://github.com/kirodotdev/KiroCrew>
- Konductor Quick Start: [README.md#quick-start](../../README.md#quick-start)
