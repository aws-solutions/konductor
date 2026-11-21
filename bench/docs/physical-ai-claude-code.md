<!-- SPDX-License-Identifier: Apache-2.0 -->
# Driving the plant from Claude Code (design note)

[← physical AI](physical-ai.md) · [benchmark your own agent](benchmark-your-own-agent.md)

The gateway does not care which agent drives it. A plant trial needs only two things from a harness: the agent's
plant tool calls reach the gateway, and the bench can read, from the agent's own stream, what the agent asked for,
so it can pair that against the gateway log. Kiro CLI and Strands do this two different ways. This note says how
Claude Code does it, what is already in, and the one step still open.

## Two ways to connect, and which one Claude Code uses

| Way | How | Agents | Adapter facts |
| --- | --- | --- | --- |
| Shim (MCP stdio) | the agent mounts one `plant` MCP server that is a small shim; the shim copies each call to the gateway socket, byte for byte | Kiro CLI | none: the shim and the gateway log are the whole trust boundary |
| Stub (forward) | the agent's own tools are stubs that forward each call to the gateway | Strands | a hook census, because a Strands hook can cancel, rewrite or retry a call |

Claude Code is the **shim** way. It speaks MCP over stdio, so it mounts the same `shim.js` the Kiro CLI arm uses, and
the plant tools appear to the model as `mcp__plant__<tool>` (Claude Code's name for an MCP tool). It has no
tool-event hook that can change a call inside the agent, so it needs no forwarder and no census: like Kiro CLI, it is
a kind-A adapter and `streamCallsOf` returns a null adapter for it.

To skip the agent's own approval prompts, a Claude Code plant run uses `--permission-mode acceptEdits` and lists the
plant tools in `--allowedTools` (`claude-code-meta.js` `noPrompt`), so no call waits on a human.

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

## The one step still open (needs a model run, deferred)

The Claude Code harness today passes `--strict-mcp-config` with no `--mcp-config` (`claude-code.js`), so it mounts no
MCP server at all. Before a Claude Code agent can drive a plant end to end, three launch-side changes are needed, and
each needs a real Claude Code run to validate (so they are not in this change):

1. For a plant arm, write a plant `.mcp.json` (the `plant` server = the run's `shim.js` + socket, as
   `agent-file.js` builds for Kiro) and pass `--mcp-config` plus `--allowedTools mcp__plant__*`, instead of the
   unconditional no-config `--strict-mcp-config`.
2. Route `claude-code` down the shim path in `openPlantRun` (`bench/runner/lib/plant/lifecycle.js`).
3. Add `cc-plant-*` arm names (`arms.js`) and a Claude Code pin check in `intake.js`. No counted suite runs until the
   pin check and the controls pass.
