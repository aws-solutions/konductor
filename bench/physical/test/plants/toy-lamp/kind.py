# SPDX-License-Identifier: Apache-2.0
"""The toy lamp kind, a test plant. kinds.py loads this file by path; it defines ENV_KIND and KIND."""
import hashlib

from sim import toy_lamp
from sim.faults import FaultError

from plant_gateway.plant_kind import PlantKind
from plant_gateway.tools import EMPTY, ToolSet

SCHEMAS = {
    "get_state": EMPTY,
    "set_lamp": {"type": "object", "required": ["on"], "additionalProperties": False, "properties": {"on": {"type": "boolean"}}},
}
DESCRIPTIONS = {"get_state": "Read the lamp and bulb sensors.", "set_lamp": "Switch the lamp on or off."}


class LampRule:
    """The rule a run uses with no Cedar policy: set_lamp on is denied while the bulb sensor reads no bulb."""

    sha256 = hashlib.sha256(b"toy-lamp-rule/1: deny set_lamp on while the bulb sensor reads false").hexdigest()

    def permits(self, tool, context):
        """True unless `tool` switches the lamp on and `context` reads no bulb."""
        return not (tool == toy_lamp.SET_LAMP and context["args"]["on"] and not context["bulb"])


def _build(environment, rng):
    if environment.get("faults"):
        raise FaultError("the toy lamp takes no faults")
    return toy_lamp.Lamp(environment["start"])


def _context(sample, tool, args, now_ms, limits, approved):
    sensors = sample["sensors"]
    return {"lamp": sensors["lamp"]["value"], "bulb": sensors["bulb"]["value"], "fresh": limits.fresh(sensors, now_ms),
            "args": args, "approved": approved}


ENV_KIND = "toy-lamp"
KIND = PlantKind(
    name="toy-lamp", sim_version=toy_lamp.SIM_VERSION, tools=ToolSet(SCHEMAS, DESCRIPTIONS, toy_lamp.META.tools),
    approvable=frozenset(), rules=toy_lamp, state_type=toy_lamp.TrueState, test_op="set_state", build=_build,
    context=_context, check_limits=lambda limits: None, fixed_rule=LampRule,
)
