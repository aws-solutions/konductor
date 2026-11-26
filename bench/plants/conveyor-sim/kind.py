# SPDX-License-Identifier: Apache-2.0
"""The conveyor plant kind. kinds.py loads this file by path; it defines ENV_KIND and KIND."""
from sim import rules
from sim.conveyor import SIM_VERSION, Conveyor, TrueState
from sim.faults import read_faults

from plant_gateway.approval import APPROVABLE
from plant_gateway.plant_kind import PlantKind
from plant_gateway.policy import FixedRule, decision_context
from plant_gateway.tools import CONVEYOR_TOOLS


def _build(environment, rng):
    return Conveyor(environment["start"], rng, read_faults(environment.get("faults", [])))


def _context(sample, tool, args, now_ms, limits, approved):
    return decision_context(sample, args, now_ms, limits, approved)


ENV_KIND = "conveyor-sim"
KIND = PlantKind(
    name="conveyor", sim_version=SIM_VERSION, tools=CONVEYOR_TOOLS, approvable=APPROVABLE, rules=rules,
    state_type=TrueState, test_op="set_state", build=_build, context=_context, check_limits=lambda limits: None,
    fixed_rule=FixedRule,
)
