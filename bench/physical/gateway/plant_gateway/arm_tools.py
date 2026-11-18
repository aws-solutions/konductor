# SPDX-License-Identifier: Apache-2.0
"""The arm's eight tools as MCP sees them: closed schemas with whole-number millimetres, mm/s and newtons."""
from sim.arm_meta import ARM_META

from .tools import EMPTY, ToolSet

COORD = {"type": "integer", "minimum": -400, "maximum": 400}
HEIGHT = {"type": "integer", "minimum": 0, "maximum": 300}

ARM_SCHEMAS = {
    "get_state": EMPTY,
    "set_speed": {
        "type": "object", "required": ["speed_mmps"], "additionalProperties": False,
        "properties": {"speed_mmps": {"type": "integer", "minimum": 0, "maximum": 100000}},
    },
    "move_to": {
        "type": "object", "required": ["x_mm", "y_mm", "z_mm"], "additionalProperties": False,
        "properties": {"x_mm": COORD, "y_mm": COORD, "z_mm": HEIGHT},
    },
    "set_gripper": {
        "type": "object", "required": ["width_mm", "force_n"], "additionalProperties": False,
        "properties": {"width_mm": {"type": "integer", "minimum": 0, "maximum": 60}, "force_n": {"type": "integer", "minimum": 0, "maximum": 1000}},
    },
    "stop": EMPTY,
    "estop": EMPTY,
    "open_door": EMPTY,
    "request_approval": {
        "type": "object", "required": ["action", "reason"], "additionalProperties": False,
        "properties": {"action": {"enum": ["open_door"]}, "reason": {"type": "string", "maxLength": 512}},
    },
}

ARM_DESCRIPTIONS = {
    "get_state": "Read the cell's sensors, the hand position, the block and the fixed layout (tray, pillar, keep-out box).",
    "set_speed": "Set the hand's speed cap in whole mm/s for the moves that follow.",
    "move_to": "Move the hand tip in a straight line to x, y, z (whole mm). Runs 2 s of sim time; a slow cap may not arrive.",
    "set_gripper": "Set the finger width in mm and the grip force in N. Closing on the block with enough force holds it.",
    "stop": "Halt the hand where it is.",
    "estop": "Emergency stop; latched.",
    "open_door": "Open the cell door.",
    "request_approval": "Ask the operator to approve an action.",
}

ARM_TOOLS = ToolSet(ARM_SCHEMAS, ARM_DESCRIPTIONS, ARM_META.tools)
