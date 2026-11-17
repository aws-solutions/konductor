# SPDX-License-Identifier: Apache-2.0
"""The MCP subset on gw.sock (8.2) for one connection: one line in, at most one reply out. Never touches a socket."""
import json

from .limits import LimitExceeded, json_depth
from .tools import TOOL_SCHEMAS, tool_list

MCP_PROTOCOL_VERSION = "2025-11-25"
SERVER_INFO = {"name": "plant-gateway", "version": "plant-mcp/1"}
PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS = -32700, -32600, -32601, -32602
KNOWN_NOTIFICATIONS = frozenset({"notifications/initialized"})
KNOWN_REQUESTS = frozenset({"initialize", "tools/list", "tools/call", "ping"})


class McpError(Exception):
    """A JSON-RPC error answer. `code` is the error code; `log_type` is the gateway event it is logged as."""

    def __init__(self, code, message, log_type="mcp_bad"):
        super().__init__(message)
        self.code = code
        self.log_type = log_type


def error_reply(rpc_id, code, message):
    """A JSON-RPC error object for request `rpc_id` (None when the id could not be read)."""
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}


class McpConnection:
    """One gw.sock connection.

    `plant` runs tool calls and logs events; `conn` is this connection's id in the log; `limits` gives the
    JSON depth and the per-run call budget.
    """

    def __init__(self, plant, conn, limits):
        self._plant = plant
        self._conn = conn
        self._limits = limits
        self._initialized = False

    def handle(self, line):
        """Returns the reply to one input `line` (bytes, no newline), or None when none is due.

        Raises LimitExceeded("calls") when this call would pass the run's call budget.
        """
        try:
            msg = self._parse(line)
        except McpError as e:
            self._plant.event(e.log_type, conn=self._conn, code=e.code, line=line[:256].decode("utf-8", "replace"))
            return error_reply(None, e.code, str(e))
        rpc_id = msg.get("id")
        try:
            return self._dispatch(msg, rpc_id)
        except McpError as e:
            self._log_refusal(e, msg.get("method"))
            return error_reply(rpc_id, e.code, str(e))

    def _log_refusal(self, error, method):
        fields = {
            "foreign_frame": {},
            "mcp_other": {"method": method, "kind": "request"},
            "mcp_bad": {"code": error.code, "method": method},
        }[error.log_type]
        self._plant.event(error.log_type, conn=self._conn, **fields)

    def _parse(self, line):
        try:
            msg = json.loads(line)
        except ValueError:
            raise McpError(PARSE_ERROR, "parse error") from None
        if not isinstance(msg, dict):
            raise McpError(INVALID_REQUEST, "batches and non-objects are not supported")
        if json_depth(msg) > self._limits.json_depth:
            raise McpError(INVALID_REQUEST, "too deeply nested")
        return msg

    def _dispatch(self, msg, rpc_id):
        if "op" in msg:
            raise McpError(INVALID_REQUEST, "control frames are not accepted here", "foreign_frame")
        method = msg.get("method")
        if not isinstance(method, str) or not _valid_id(msg):
            raise McpError(INVALID_REQUEST, "invalid request")
        if "id" not in msg:
            return self._notification(method)
        if method not in KNOWN_REQUESTS:
            raise McpError(METHOD_NOT_FOUND, "method not found", "mcp_other")
        if method == "initialize":
            return self._initialize(msg, rpc_id)
        if not self._initialized:
            raise McpError(INVALID_REQUEST, "connection not initialized")
        return {"jsonrpc": "2.0", "id": rpc_id, "result": self._request(method, msg.get("params") or {}, rpc_id)}

    def _notification(self, method):
        if method not in KNOWN_NOTIFICATIONS:
            self._plant.event("mcp_other", conn=self._conn, method=method, kind="notification")
            return None
        self._plant.event("mcp", conn=self._conn, method=method)
        return None

    def _initialize(self, msg, rpc_id):
        version = (msg.get("params") or {}).get("protocolVersion")
        if version != MCP_PROTOCOL_VERSION:
            raise McpError(INVALID_PARAMS, f"unsupported protocol version; this server speaks {MCP_PROTOCOL_VERSION}")
        self._initialized = True
        self._plant.event("mcp", conn=self._conn, method="initialize", client=_client_of(msg.get("params") or {}))
        result = {"protocolVersion": MCP_PROTOCOL_VERSION, "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}
        return {"jsonrpc": "2.0", "id": rpc_id, "result": result}

    def _request(self, method, params, rpc_id):
        if method == "tools/call":
            return self._call(params, rpc_id)
        if method == "tools/list":
            self._plant.event("mcp", conn=self._conn, method=method)
            return {"tools": tool_list()}
        self._plant.event("mcp", conn=self._conn, method=method)
        return {}

    def _call(self, params, rpc_id):
        name = params.get("name")
        if name not in TOOL_SCHEMAS:
            raise McpError(INVALID_PARAMS, "unknown tool")
        if self._plant.calls >= self._limits.calls_per_run:
            raise LimitExceeded("calls")
        args = params.get("arguments", {})
        return self._plant.call(name, args, rpc_id, self._conn)


def _valid_id(msg):
    if "id" not in msg:
        return True
    rpc_id = msg["id"]
    return isinstance(rpc_id, str) or (isinstance(rpc_id, int) and not isinstance(rpc_id, bool))


# How much of the client's self-description the log keeps. It is agent-written text, so only short strings pass.
CLIENT_FIELD_MAX = 64


def _client_of(params):
    """`{name, version}` from `initialize` params' `clientInfo` (A-6), each a string cut to CLIENT_FIELD_MAX, or None."""
    info = params.get("clientInfo")
    if not isinstance(info, dict):
        return None
    return {k: info[k][:CLIENT_FIELD_MAX] if isinstance(info.get(k), str) else None for k in ("name", "version")}
