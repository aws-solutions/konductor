# SPDX-License-Identifier: Apache-2.0
"""Tool sets as MCP sees them (8.3), argument checks and the canonical-args key. Never touches the plant."""
import hashlib
import json

from sim.meta import TOOLS

from .schema import SchemaError, check

EMPTY = {"type": "object", "properties": {}, "additionalProperties": False}
TOOLS_VERSION = 1

TOOL_SCHEMAS = {
    "get_state": EMPTY,
    "set_speed": {
        "type": "object", "required": ["speed_mmps"], "additionalProperties": False,
        "properties": {"speed_mmps": {"type": "integer", "minimum": 0, "maximum": 100000}},
    },
    "start": EMPTY,
    "stop": EMPTY,
    "estop": EMPTY,
    "reset_estop": EMPTY,
    "open_guard": EMPTY,
    "request_approval": {
        "type": "object", "required": ["action", "reason"], "additionalProperties": False,
        "properties": {"action": {"enum": ["open_guard", "reset_estop"]}, "reason": {"type": "string", "maxLength": 512}},
    },
}

DESCRIPTIONS = {
    "get_state": "Read the line's sensors and panel.",
    "set_speed": "Set the belt's target speed in whole mm/s.",
    "start": "Start the belt motor.",
    "stop": "Stop the belt motor; the belt is at speed 0 when this returns.",
    "estop": "Emergency stop; latched.",
    "reset_estop": "Clear the latched emergency stop; needs an approved clearance first.",
    "open_guard": "Open the guard over the belt.",
    "request_approval": "Ask the operator to approve an action.",
}


class BadArguments(ValueError):
    """Arguments that do not match the tool's closed schema."""


class ToolSet:
    """The tools of one plant kind: `schemas` (tool name to closed argument schema) and `descriptions` (name to text).

    Raises ImportError when the names differ from `expected`, the shared metadata's tool list.
    """

    def __init__(self, schemas, descriptions, expected):
        if tuple(schemas) != tuple(expected) or set(descriptions) != set(schemas):
            raise ImportError(f"tool schemas {tuple(schemas)} differ from the shared metadata tools {tuple(expected)}")
        self.schemas = schemas
        self._descriptions = descriptions

    def listing(self):
        """The `tools/list` result entries, in a fixed order."""
        return [{"name": name, "description": self._descriptions[name], "inputSchema": schema} for name, schema in self.schemas.items()]

    def check_args(self, tool, args):
        """Raises BadArguments unless `args` match `tool`'s schema. Floats such as 700.0 are refused for integers."""
        try:
            check(args, self.schemas[tool])
        except SchemaError as e:
            raise BadArguments(str(e)) from None


CONVEYOR_TOOLS = ToolSet(TOOL_SCHEMAS, DESCRIPTIONS, TOOLS)


def tool_list():
    """The conveyor's `tools/list` result entries, in a fixed order."""
    return CONVEYOR_TOOLS.listing()


def check_args(tool, args):
    """Raises BadArguments unless `args` match the conveyor tool's schema."""
    CONVEYOR_TOOLS.check_args(tool, args)


def _integral_floats_as_ints(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _integral_floats_as_ints(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_integral_floats_as_ints(v) for v in value]
    return value


def canonical_args(args):
    """The multiset-match form of `args` (9.1): sorted keys, no spaces, UTF-8 kept, and a number with no
    fraction written as an integer (700.0 becomes 700), as Node's JSON.stringify writes it."""
    return json.dumps(_integral_floats_as_ints(args), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def args_sha256(args):
    """SHA-256 hex of `canonical_args(args)`, stored on every `call` event as the cheap match key."""
    return hashlib.sha256(canonical_args(args).encode("utf-8")).hexdigest()
