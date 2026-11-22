<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driving the plant from Claude Code (design note)

[← physical AI](physical-ai.md) · [benchmark your own agent](benchmark-your-own-agent.md)

The gateway does not care which agent drives it. A plant trial needs only two things from a harness: the agent's
plant tool calls reach the gateway, and the bench can read, from the agent's own stream, what the agent asked for,
so it can pair that against the gateway log. Kiro CLI and Strands do this two different ways. This note says how
Claude Code does it, what is in, and what still needs a paid run.

## Two ways to connect, and which one Claude Code uses

| Way | How | Agents | Adapter facts |
| --- | --- | --- | --- |
| Shim (MCP stdio) | the agent mounts one `plant` MCP server that is a small shim; the shim copies each call to the gateway socket, byte for byte | Kiro CLI | none: the shim and the gateway log are the whole trust boundary |
| Stub (forward) | the agent's own tools are stubs that forward each call to the gateway | Strands | a hook census, because a Strands hook can cancel, rewrite or retry a call |

Claude Code is the **shim** way. It speaks MCP over stdio, so it mounts the same `shim.js` the Kiro CLI arm uses, and
the plant tools appear to the model as `mcp__plant__<tool>` (Claude Code's name for an MCP tool). It has no
tool-event hook that can change a call inside the agent, so it needs no forwarder and no census: like Kiro CLI, it is
a kind-A adapter and `streamCallsOf` returns a null adapter for it.

To skip the agent's own approval prompts, a Claude Code plant run uses `--permission-mode acceptEdits` and allows
the whole plant server in `--allowedTools` (`claude-code-meta.js` `noPrompt`), so no call waits on a human.

## What the stream-to-gateway check needs (done)

The check pairs the plant calls in the agent's stream with the gateway's `call` events as a multiset of
(tool, canonical args). For Claude Code the stream is `claude-stream-json`: a plant call is a `tool_use` block in an
`assistant` event whose `name` starts with `mcp__plant__`. `plantCallsInClaudeStream` in
`bench/runner/lib/plant/stream-match.js` reads those, strips the prefix for the tool name, and keys each by its input
hashed with the same canonical hash the Python gateway computes (`argsSha256`). `streamCallsOf` routes
`claude-stream-json` to it. A `mcp__plant__` name with nothing after it stays unreadable and so stays a mismatch,
which fails safe.

Tested without any model call in `bench/runner/test/plant-stream-match.test.js`: a Claude `set_speed` call hashes to
the gateway's own `args_sha256` vector and pairs with a gateway log line; non-plant tools and non-assistant events are
ignored.

## Mounting the shim (done, fake agent only)

The arms are `cc-plant-policy` and `cc-plant-allowall`. They run no `--agent` and install nothing.

| Part | What it does | Where |
| --- | --- | --- |
| Mount | the run's HOME gets `.claude/plant-mcp.json`: one `plant` server, the run's read-only `shim.js` on its own `gw.sock`. The command passes it with `--mcp-config` and keeps `--strict-mcp-config`, so no other MCP server loads | `lifecycle.js` (`MOUNTS['mcp-config']`), `agent-file.js` (`plantMcpConfig`), `claude-code.js` `buildCommand` |
| Prompt | the one-line operator prompt the Kiro plant agent carries, on `--append-system-prompt`; the task prompt on stdin | `agent-file.js` `plantPrompt` |
| Tools | `--tools Read Write Edit Bash Glob Grep`, the Claude Code names of the Kiro plant agent's built-ins; no Task or other spawn tool exists. `--allowedTools mcp__plant` plus those six, so no call waits on a person | `claude-code.js` `PLANT_TOOLS` |
| Pin | a release pins one build in `versions.claudeCode` (`{version, sha256}`). A binary of another version is a control; one of the pinned version with another SHA-256 is refused | `intake.js` `claudeSuiteOf` |
| Evidence | `installed-mcp.json` in the run directory, next to `stream.jsonl` | `claude-code.js` `collectArtifacts` |

Each harness descriptor names its plant mount and its pin key (`plant: {mount, pinKey}`), and a plant arm whose
stream format has no plant reader is refused before the first trial (`checkSuiteShape`).

Tested with no model in `bench/runner/test/plant-claude-code.test.js`: a fake Claude Code
(`fake-plant-claude.js`) reads the MCP config, starts the shim, and makes its calls through a real gateway. The trial
scores complete with zero mismatches. A call the gateway never saw, and a call with no tool name, are mismatches.

## Controls (done, free)

Each scripted control runs as Claude Code too: `bench/physical/controls/<control>-claude` is a link to its `-kiro`
file, and `plant-control.js` sees Claude Code's command line (`-p ... --mcp-config FILE`), takes the shim from that
file and the prompt from stdin, and writes a Claude Code stream. `resolveClaude` accepts these files and nothing else
that small, a control run needs no AWS keys, and the plant report lists the suite under Controls
(`bench/runner/test/plant-claude-controls.test.js`; the arm controls in `plant-arm-controls.test.js`).

## Still open (paid, needs the owner)

- One real Claude Code plant run, to check that the real binary reads the MCP config, names the tools
  `mcp__plant__<tool>`, and offers no Task tool. Plan: one `cc-plant-allowall` trial and one `cc-plant-policy` trial
  on one arm task, `--run-budget-usd 1` each and `--budget-usd 2`, so at most USD 2. A free dry run of the same
  command with the scripted control as `--claude-bin` passes.
- A release with a `versions.claudeCode` pin, before any counted run.
