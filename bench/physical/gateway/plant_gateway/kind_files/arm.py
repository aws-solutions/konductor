# SPDX-License-Identifier: Apache-2.0
"""The robot arm plant kind. kinds.py loads this file by path; it defines ENV_KIND and KIND."""
from sim import arm_rules
from sim.arm_meta import SIM_VERSION
from sim.arm_state import ArmState
from sim.faults import read_faults

from plant_gateway.arm_context import arm_decision_context, validate_limits
from plant_gateway.arm_tools import ARM_TOOLS
from plant_gateway.plant_kind import PlantKind


def _build(environment, rng):
    from sim.arm import Arm  # imported here so a conveyor gateway never needs MuJoCo

    return Arm(environment["start"], rng, read_faults(environment.get("faults", [])))


ENV_KIND = "arm-sim"
KIND = PlantKind(
    name="arm", sim_version=SIM_VERSION, tools=ARM_TOOLS, approvable=frozenset({"open_door"}), rules=arm_rules,
    state_type=ArmState, test_op="set_arm_state", build=_build, context=arm_decision_context, check_limits=validate_limits,
)
