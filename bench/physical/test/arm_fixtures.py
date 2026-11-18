# SPDX-License-Identifier: Apache-2.0
"""Builders shared by the arm tests: a plant session on real temp logs with the arm's stub release policy.
Importing this module needs MuJoCo and cedarpy; a test file that cannot import them skips its tests."""
import os
import random
import tempfile

import cedarpy

import _paths  # noqa: F401
from arm_release_stub import CEDAR_POLICY, CEDAR_SCHEMA, SENSOR_LIMITS
from gateway_fixtures import RUN_ID, read_jsonl
from plant_gateway.approval import ApprovalBook
from plant_gateway.kinds import ARM
from plant_gateway.log import GatewayLog, WorldLog
from plant_gateway.plant import PlantSession
from plant_gateway.policy import ARMS, CedarPolicy, SensorLimits
from sim.arm import Arm
from sim.faults import read_faults

START = {"rated_max_mmps": 250}
GRANTING_OPERATOR = {"approvals": {"open_door": "granted"}, "expireAfterMs": 20000}


def release_policy():
    """The stub release's CedarPolicy and SensorLimits."""
    return CedarPolicy(CEDAR_POLICY, CEDAR_SCHEMA, cedarpy), SensorLimits(SENSOR_LIMITS)


class ArmRig:
    """A PlantSession of the arm on a fresh temp dir. `arm_name` is "policy" or "allow-all"; `start` is the task start
    block; `operator` the task operator block; `faults` the task faults list."""

    def __init__(self, arm_name="policy", start=START, seed=1, operator=GRANTING_OPERATOR, faults=()):
        self.dir = tempfile.TemporaryDirectory()
        self.glog = GatewayLog(self.path("gateway.jsonl"), RUN_ID, lambda: "t")
        self.wlog = WorldLog(self.path("world.jsonl"), RUN_ID, lambda: "t")
        self.arm = Arm(start, random.Random(seed), read_faults(faults))
        self.wlog.snapshot("tick", self.arm.state, self.arm.view, self.arm.drain_poses())
        rule, limits = release_policy()
        self.plant = PlantSession(self.arm, rule, ARMS[arm_name](), ApprovalBook(operator), limits, self.glog, self.wlog, ARM)

    def path(self, name):
        return os.path.join(self.dir.name, name)

    def call(self, tool, args=None):
        """Makes one call and returns its MCP result."""
        return self.plant.call(tool, args or {}, 1, 1)

    def events(self):
        return read_jsonl(self.path("gateway.jsonl"))

    def types(self):
        return [e["type"] for e in self.events()]

    def world(self):
        return read_jsonl(self.path("world.jsonl"))

    def close(self):
        self.glog.close()
        self.wlog.close()
        self.dir.cleanup()
