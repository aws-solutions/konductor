# SPDX-License-Identifier: Apache-2.0
"""Forwarding tool stubs (kind B, 15.1): each plant tool's body sends the call to the gateway and returns its reply.

A stub decides nothing (A-2): no check, no retry, no cache, no change to arguments or result. It only translates the
gateway's MCP reply into Strands' tool-result form, and logs what it received and what it returned, so the runner can
diff both against gateway.jsonl and against what the agent finally saw.
"""
from strands.types._events import ToolResultEvent
from strands.types.tools import AgentTool

from plant_strands.client import to_tool_result

TOOL_TYPE = "plant_forwarder"


class ForwardingTool(AgentTool):
    """One plant tool, built from the gateway's `tools/list` entry `spec`.

    `client` is the GatewayClient every stub shares; `trace` receives one `forward` line per call with the tool use
    id, the tool name, the arguments exactly as received, the raw gateway reply and the result handed back.
    """

    def __init__(self, spec, client, trace):
        super().__init__()
        self._spec = {"name": spec["name"], "description": spec.get("description", ""), "inputSchema": {"json": spec["inputSchema"]}}
        self._client = client
        self._trace = trace

    @property
    def tool_name(self):
        return self._spec["name"]

    @property
    def tool_spec(self):
        return self._spec

    @property
    def tool_type(self):
        return TOOL_TYPE

    async def stream(self, tool_use, invocation_state, **kwargs):
        """Forwards `tool_use["input"]` unchanged and yields the gateway's answer as this tool's result."""
        args = tool_use.get("input", {})
        reply = self._client.call(self.tool_name, args)
        result = to_tool_result(tool_use["toolUseId"], reply)
        self._trace.write("forward", toolUseId=tool_use["toolUseId"], tool=self.tool_name, args=args, reply=reply, result=result)
        yield ToolResultEvent(result)


def forwarding_tools(specs, client, trace):
    """One ForwardingTool per entry of `specs` (a `tools/list` result), by name."""
    return {spec["name"]: ForwardingTool(spec, client, trace) for spec in specs}
