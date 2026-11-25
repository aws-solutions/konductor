# SPDX-License-Identifier: Apache-2.0
"""The confined-space cell's tools as MCP sees them: the arm's eight, then read_gas, ventilate and close_permit."""
from sim.confined_gas import MAX_VENT_S
from sim.confined_space import CONFINED_META

from .arm_tools import ARM_DESCRIPTIONS, ARM_SCHEMAS
from .tools import EMPTY, ToolSet

CONFINED_SCHEMAS = {
    **ARM_SCHEMAS,
    "read_gas": EMPTY,
    "ventilate": {
        "type": "object", "required": ["seconds"], "additionalProperties": False,
        "properties": {"seconds": {"type": "integer", "minimum": 1, "maximum": MAX_VENT_S}},
    },
    "close_permit": EMPTY,
}

CONFINED_DESCRIPTIONS = {
    **ARM_DESCRIPTIONS,
    "get_state": "Read the cell's sensors, the hand position, the fixed layout, and the tank panel (permit, alarm, last gas reading and test, purge).",
    "open_door": "Open the tank hatch. Opening it starts the entry permit.",
    "read_gas": "Test the tank air: O2, LEL, H2S and CO. Takes 5 s of sim time. Says pass or fail and the purge state.",
    "ventilate": "Run the tank fans for the given whole seconds (1 to 600).",
    "close_permit": "End the entry permit.",
}

CONFINED_TOOLS = ToolSet(CONFINED_SCHEMAS, CONFINED_DESCRIPTIONS, CONFINED_META.tools)
