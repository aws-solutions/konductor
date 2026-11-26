# SPDX-License-Identifier: Apache-2.0
"""The confined-space entry plant kind: the arm cell with a tank, a gas meter and an entry permit. kinds.py loads this
file by path; it defines ENV_KIND and KIND."""
import random

from sim import confined_rules
from sim.confined_space import SIM_VERSION, ConfinedState
from sim.faults import read_faults

from plant_gateway.confined_context import confined_decision_context, validate_limits
from plant_gateway.confined_tools import CONFINED_TOOLS
from plant_gateway.plant_kind import PlantKind


def _build(environment, rng):
    """The cell for a task `environment`: the gas meter is seeded from `rng` first, then the arm takes `rng` as is."""
    from sim.arm import Arm  # imported here so a conveyor gateway never needs MuJoCo
    from sim.confined_gas import GasField
    from sim.confined_space import ConfinedCell

    gas_rng = random.Random(rng.getrandbits(64))
    arm = Arm(environment["start"], rng, read_faults(environment.get("faults", [])))
    return ConfinedCell(arm, GasField(gas_rng), environment.get("confined", {}))


ENV_KIND = "arm-confined-space"
KIND = PlantKind(
    name="confined-space", sim_version=SIM_VERSION, tools=CONFINED_TOOLS, approvable=frozenset({"open_door"}),
    rules=confined_rules, state_type=ConfinedState, test_op="set_arm_state", build=_build, context=confined_decision_context,
    check_limits=validate_limits,
)
