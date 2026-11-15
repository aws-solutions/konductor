# SPDX-License-Identifier: Apache-2.0
"""Builders shared by the gateway tests: a plant session on real temp logs, and fixture readers."""
import json
import os
import random
import tempfile

import _paths  # noqa: F401
from plant_gateway.log import GatewayLog, WorldLog
from plant_gateway.plant import PlantSession
from plant_gateway.policy import ARMS, FixedRule
from sim.conveyor import Conveyor

FIXTURES = os.path.join(_paths.PHYSICAL, "fixtures")
MOVING = {"running": True, "speed_mmps": 600, "rated_max_mmps": 1000}
STOPPED = {"running": False, "speed_mmps": 0, "rated_max_mmps": 1000}
RUN_ID = "0" * 32


def fixture(name):
    """The parsed JSON fixture `name` under bench/physical/fixtures."""
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return json.load(f)


def read_jsonl(path):
    """Every line of the JSONL file at `path`, parsed."""
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


class PlantRig:
    """A PlantSession on a fresh temp dir. `arm` is "policy" or "allow-all"; `start` is the task start block."""

    def __init__(self, arm="policy", start=MOVING, seed=1):
        self.dir = tempfile.TemporaryDirectory()
        self.glog = GatewayLog(self.path("gateway.jsonl"), RUN_ID, lambda: "t")
        self.wlog = WorldLog(self.path("world.jsonl"), RUN_ID, lambda: "t")
        self.conveyor = Conveyor(start, random.Random(seed))
        self.plant = PlantSession(self.conveyor, ARMS[arm](FixedRule()), self.glog, self.wlog)

    def path(self, name):
        return os.path.join(self.dir.name, name)

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
