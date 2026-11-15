# SPDX-License-Identifier: Apache-2.0
"""Toy stdio MCP server for the step 0 capture. Logs every line in and out. Never touches a real plant."""
import json
import os
import sys
import time

EMPTY_SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}
TOOLS = [
    {"name": "get_state", "description": "Read the toy conveyor state.", "inputSchema": EMPTY_SCHEMA},
    {"name": "fail_tool", "description": "Always fails (step 0 capture).", "inputSchema": EMPTY_SCHEMA},
]


class RpcError(Exception):
    """A JSON-RPC error answer. `code` is the JSON-RPC error code, `message` its text."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def append_log(log_path, direction, line):
    """Appends one wire line to `log_path`. `direction` is "in" or "out". No-op when `log_path` is empty."""
    if not log_path:
        return
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": round(time.time(), 3), "dir": direction, "line": line}) + "\n")


def call_tool(name, rpc_id):
    """Runs toy tool `name`. `get_state` echoes `rpc_id`; `fail_tool` and unknown names raise RpcError."""
    if name == "get_state":
        text = json.dumps({"running": True, "speed_mmps": 600, "guard": "closed", "rpc_id_seen": rpc_id})
        return {"content": [{"type": "text", "text": text}], "isError": False}
    if name == "fail_tool":
        raise RpcError(-32000, "toy failure")
    raise RpcError(-32602, "unknown tool")


def answer(msg):
    """Returns the result for request `msg`. Echoes the client's protocol version on `initialize`."""
    method = msg.get("method")
    params = msg.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion"), "capabilities": {"tools": {}},
                "serverInfo": {"name": "toy-plant", "version": "0"}}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "ping":
        return {}
    if method == "tools/call":
        return call_tool(params.get("name"), msg.get("id"))
    raise RpcError(-32601, "method not found")


def response_for(line):
    """Returns the JSON-RPC response object for one input `line`, or None for a notification."""
    try:
        msg = json.loads(line)
    except ValueError:
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
    if "id" not in msg:
        return None
    try:
        return {"jsonrpc": "2.0", "id": msg["id"], "result": answer(msg)}
    except RpcError as e:
        return {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": e.code, "message": e.message}}


def serve(stdin, stdout, log_path):
    """Answers newline-delimited JSON-RPC from `stdin` on `stdout`, logging both ways to `log_path`."""
    for raw in stdin:
        line = raw.rstrip("\n")
        append_log(log_path, "in", line)
        response = response_for(line)
        if response is None:
            continue
        out = json.dumps(response)
        append_log(log_path, "out", out)
        stdout.write(out + "\n")
        stdout.flush()


if __name__ == "__main__":
    serve(sys.stdin, sys.stdout, os.environ.get("TOY_MCP_LOG"))
