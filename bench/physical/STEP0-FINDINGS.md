# Step 0 findings: one real Kiro CLI start with a toy MCP server

Date: 2026-11-15. Host: Linux 6.12, Python 3.9.25, Node 24.21.0, `kiro-cli 3.3.0`.
Fixtures: `bench/physical/fixtures/step0/`. Spec test: `bench/physical/test/step0-fixtures.test.js`.
Toy server: `bench/physical/step0/toy_mcp.py` (two tools, logs every wire line).

## How it was captured

The agent file was a workspace agent, `<cwd>/.kiro/agents/plant.json`, with `"tools": ["@builtin", "@plant"]`
and one stdio MCP server `plant`. One tiny prompt per run:
`kiro-cli chat --no-interactive --trust-all-tools --agent-engine v2 --output-format stream-json --agent plant --require-mcp-startup "<prompt>"`.
Runs were not inside bench's sandbox, because `unshare` is blocked on this host (below). Total spend: under 1 credit.

## Results

| Question | Result | Fixture |
|---|---|---|
| Agent-file fields that load | `name`, `description`, `prompt`, `tools`, `allowedTools`, `mcpServers` (`command`, `args`, `env`), `resources`, `hooks` all load; the `@plant` tools ran. `kiro-cli agent validate` also exits 0 on an unknown field, so validate is no proof a field is read | `plant-agent.step0.json` |
| Handshake, engine v2 | `initialize` (id 0, `protocolVersion` `2025-11-25`, client `Q DEV CLI`), `notifications/initialized`, `tools/list` (id 1). No `ping` seen | `kiro-v2.mcp-wire.jsonl` |
| Handshake, engine v3 | First a `server/discover` request, id `"server-discover-probe-1"`, protocol `2026-07-28` in `_meta`. On `-32601` it falls back to `initialize` with `2025-11-25` | `kiro-v3.mcp-wire.jsonl` |
| MCP protocol version to pin | `2025-11-25` on both engines. The gateway must answer `server/discover` with `-32601` (8.2 already says so for unknown methods) | both wire files |
| Tool names in the stream | v2: title `Running: @plant/get_state`, `_meta.kiro.toolName` `get_state`, `mcpServerName` `plant`. v3: title `@plant/get_state`, `_meta.kiro.serverName` `plant` | stream fixtures |
| Per-call id in the stream that maps to `rpc_id` | **None.** The stream carries only `toolCallId`, the model's tool-use id (`toolu_bdrk_...`). The JSON-RPC id is a per-server counter (0, 1, 2, ...) that never appears in the stream. `tools/call` carries `name`, `arguments` and `_meta.progressToken` (another counter), but no tool-use id. Nothing joins the two by value | `kiro-v2.plant.stream.jsonl`, `kiro-v2.mcp-wire.jsonl` |
| `tool_search` behaviour | v2: plant tools are offered directly, no search step. v3: the model first runs a `Tool Load` call with `rawInput.id` `tool::plant::get_state`, then calls `@plant/get_state` | `kiro-v3.plant.stream.trimmed.jsonl` |
| A JSON-RPC error | `fail_tool` answered `{"code":-32000}`. v2 stream: `tool_call_update` with `status: "failed"` and no `rawOutput`; the message reaches only the session transcript ("Mcp error: -32000: toy failure") | `kiro-v2.plant.stream.jsonl` |
| Does `@builtin` have a spawn tool | **Yes, on v2: `subagent`.** The 16 tools the model listed: code, fail_tool, get_state, glob, goal, grep, introspect, knowledge, read, shell, subagent, todo_list, use_aws, web_fetch, web_search, write. So the plant agent file must list built-in tools by name, not `@builtin` | `kiro-v2.tool-names.json` |
| `--require-mcp-startup` with a dead server | Exit 3; stream ends with `runError`, `stage: "init"` (matches 8.5) | `kiro-v2.require-mcp-fail.stream.jsonl` |
| v3 stream content | v3 puts the host's steering file names and paths and the user's other agents in `session_info_update` and `available_commands_update` lines. The fixture keeps only tool and run lines | trimmed fixture |

## Host checks

| Check | Result |
|---|---|
| `connect()` to a Unix socket on a read-only mount | **Works.** Connected to an existing socket on a mount with `ro` in `findmnt` options; a file write on the same mount gave `EROFS`. Supports the 13.2 claim |
| Capability drop (`setpriv --no-new-privs --bounding-set -all --inh-caps -all`) | Works unprivileged: `CapInh`, `CapPrm`, `CapEff`, `CapBnd`, `CapAmb` all zero |
| `unshare --user`, `unshare --mount`, nested `unshare --user --pid --fork` | **Blocked here**: `Operation not permitted` (the process runs under a seccomp filter). Not worked around. So bench's sandbox, the nested-namespace row and reading the sandbox pid namespace from outside could not be tested on this host |
| `/proc/<pid>/task/<tid>/children` | Present (needed by 8.1 to find the sandbox's first process); not tried against a real `unshare --fork` |
| `SO_PEERCRED` from Python stdlib | Works; peer pid read, `/proc/<pid>/ns/pid` link read |
| `NS_GET_PARENT` ioctl from Python stdlib | Callable; on the host's root pid namespace it returns `EPERM`, as expected. A nested namespace was not available to test the walk |
| fd 3 from Node to Python | Node's extra `pipe` stdio slot opened with `socket.socket(fileno=3)` in Python: a line written there reached Node |

## Claims checked against the design

| Design claim | Verdict |
|---|---|
| SR-9, 7.7, 9.1: the runner matches each stream plant call to a gateway `call` event "by `rpc_id`" | **Wrong as written.** No value in the stream equals or maps to the JSON-RPC id, on v2 or v3. A match is only possible by order: per connection, the n-th `tools/call` for a tool against the n-th stream `tool_call` for that `@plant` tool. Order may differ under parallel calls, a retry after `-32000` and the shim's reconnect replay, which are exactly the path-control cases (FR-18). This needs an owner decision before the gateway log format and the stream match are built |
| 6.2: plant agent file has "built-in tools plus `@plant`; no spawn tools" | Holds only if built-ins are listed by name. `@builtin` brings `subagent` |
| 8.2: pin the MCP protocol version from the capture | `2025-11-25`. v3 also sends `server/discover` first |
| 13.2: `connect()` on a read-only mount is allowed | Confirmed |
| 8.5: exit 3 under `--require-mcp-startup` | Confirmed |
