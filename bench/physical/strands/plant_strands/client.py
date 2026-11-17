# SPDX-License-Identifier: Apache-2.0
"""MCP client for gw.sock, used by the forwarding stubs. Sends each call unchanged and returns the reply unchanged.

Standard library only, so it runs on the gateway's Python too. It holds no token and no log descriptor (A-7).
"""
import json
import socket

MCP_VERSION = "2025-11-25"
# Sent in `initialize`, so the gateway's `mcp` log names the adapter (A-6).
CLIENT_INFO = {"name": "plant-strands-forwarder", "version": "1"}
LOST_CODE = -32000
LOST = "plant connection lost"


class ConnectionLost(Exception):
    """The socket closed before the reply to an open request arrived."""


class GatewayClient:
    """One MCP session on the gateway socket at `socket_path`.

    `connect` opens a connected stream socket for a path (a Unix socket by default; tests may pass their own). The
    first request dials and sends `initialize` plus `notifications/initialized`. A request that loses the connection
    is answered with error `-32000` (A-5), and the next request dials again and replays the handshake, as the shim
    does. Requests run one at a time: the caller blocks until the reply, so ids never interleave.
    """

    def __init__(self, socket_path, connect=None):
        self.socket_path = socket_path
        self.connect = connect or _unix_connect
        self.sock = None
        self.buf = b""
        self.next_id = 0
        self.dials = 0

    def tools_list(self):
        """The gateway's tool list (`tools/list` result `tools`). Raises ConnectionLost or RuntimeError on an error reply."""
        reply = self.request("tools/list", {})
        if "error" in reply:
            raise RuntimeError("tools/list failed: %s" % json.dumps(reply["error"]))
        return reply["result"]["tools"]

    def call(self, name, arguments):
        """The JSON-RPC reply to `tools/call` of tool `name` with `arguments`, exactly as received.

        A lost connection gives `{"error": {"code": -32000, "message": "plant connection lost"}}` and no retry: the
        call may already have run, so sending it again would change its meaning (A-2).
        """
        try:
            return self.request("tools/call", {"name": name, "arguments": arguments})
        except ConnectionLost:
            return {"jsonrpc": "2.0", "error": {"code": LOST_CODE, "message": LOST}}

    def request(self, method, params):
        """Sends one request and returns its reply object. Raises ConnectionLost when the socket closes first."""
        if self.sock is None:
            self._dial()
        return self._roundtrip(method, params)

    def close(self):
        """Closes the socket if open."""
        if self.sock is not None:
            self.sock.close()
            self.sock = None

    def _dial(self):
        self.sock = self.connect(self.socket_path)
        self.buf = b""
        self.dials += 1
        reply = self._roundtrip("initialize", {"protocolVersion": MCP_VERSION, "capabilities": {}, "clientInfo": CLIENT_INFO})
        if "error" in reply:
            self.close()
            raise RuntimeError("initialize refused: %s" % json.dumps(reply["error"]))
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _roundtrip(self, method, params):
        request_id = "fwd-%d" % self.next_id
        self.next_id += 1
        try:
            self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            while True:
                reply = self._read()
                if reply.get("id") == request_id:
                    return reply
        except (ConnectionLost, OSError):
            self.close()
            raise ConnectionLost(method)

    def _send(self, obj):
        self.sock.sendall((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))

    def _read(self):
        while b"\n" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionLost("closed")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        return json.loads(line)


def _unix_connect(path):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(path)
    return sock


def to_tool_result(tool_use_id, reply):
    """The Strands ToolResult for JSON-RPC `reply` to a `tools/call`.

    A result maps its text items to `{"text"}` blocks and its `structuredContent` to one `{"json"}` block; `isError`
    gives status "error". A JSON-RPC error (including the -32000 of a lost connection) gives status "error" with the
    code and message as text. Nothing else changes.
    """
    if "error" in reply:
        error = reply["error"]
        return {"toolUseId": tool_use_id, "status": "error", "content": [{"text": "MCP error %s: %s" % (error.get("code"), error.get("message"))}]}
    result = reply.get("result") or {}
    content = [{"text": item["text"]} for item in result.get("content", []) if item.get("type") == "text"]
    if "structuredContent" in result:
        content.append({"json": result["structuredContent"]})
    return {"toolUseId": tool_use_id, "status": "error" if result.get("isError") else "success", "content": content}
