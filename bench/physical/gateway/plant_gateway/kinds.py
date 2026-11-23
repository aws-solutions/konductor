# SPDX-License-Identifier: Apache-2.0
"""The plant kinds the gateway can run (conveyor, arm): what each one brings to a run. Never decides a call."""
from dataclasses import dataclass
from types import ModuleType
from typing import Callable, FrozenSet, Optional

from sim import arm_rules, rules
from sim.arm_meta import SIM_VERSION as ARM_SIM_VERSION
from sim.arm_state import ArmState
from sim.conveyor import SIM_VERSION as CONVEYOR_SIM_VERSION
from sim.conveyor import Conveyor, TrueState
from sim.faults import read_faults

from .approval import APPROVABLE
from .arm_context import arm_decision_context, validate_limits
from .arm_tools import ARM_TOOLS
from .policy import FixedRule, decision_context
from .tools import CONVEYOR_TOOLS, ToolSet


@dataclass(frozen=True)
class PlantKind:
    """One kind of plant.

    `name` is what a task's `environment.plant` says. `sim_version` goes into the startup line. `tools` is the MCP
    ToolSet. `approvable` lists the actions an approval record can cover. `rules` is the module with
    `attempt_rules`, `executed_harm`, `settle_harm` and `procedure_harm`. `state_type` builds a true state from a
    test-mode frame, which arrives as control op `test_op`. `build` makes the simulator from a task `environment`
    and a seeded `random.Random`. `context(sample, tool, args, now_ms, limits, approved)` builds the Cedar context.
    `check_limits(limits)` raises PolicyInvalid when the sensor limits lack what the kind needs. `fixed_rule` is the
    rule class a run uses when hello lists no Cedar policy, or None when the kind always needs one.
    """

    name: str
    sim_version: str
    tools: ToolSet
    approvable: FrozenSet[str]
    rules: ModuleType
    state_type: type
    test_op: str
    build: Callable
    context: Callable
    check_limits: Callable
    fixed_rule: Optional[type] = None


def _build_conveyor(environment, rng):
    return Conveyor(environment["start"], rng, read_faults(environment.get("faults", [])))


def _build_arm(environment, rng):
    from sim.arm import Arm  # imported here so a conveyor gateway never needs MuJoCo

    return Arm(environment["start"], rng, read_faults(environment.get("faults", [])))


def _conveyor_context(sample, tool, args, now_ms, limits, approved):
    return decision_context(sample, args, now_ms, limits, approved)


CONVEYOR = PlantKind(
    name="conveyor", sim_version=CONVEYOR_SIM_VERSION, tools=CONVEYOR_TOOLS, approvable=APPROVABLE, rules=rules,
    state_type=TrueState, test_op="set_state", build=_build_conveyor, context=_conveyor_context, check_limits=lambda limits: None,
    fixed_rule=FixedRule,
)
ARM = PlantKind(
    name="arm", sim_version=ARM_SIM_VERSION, tools=ARM_TOOLS, approvable=frozenset({"open_door"}), rules=arm_rules,
    state_type=ArmState, test_op="set_arm_state", build=_build_arm, context=arm_decision_context, check_limits=validate_limits,
)
KINDS = {"conveyor-sim": CONVEYOR, "arm-sim": ARM}
