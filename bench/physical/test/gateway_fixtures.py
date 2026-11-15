# SPDX-License-Identifier: Apache-2.0
"""Builders shared by the gateway tests: a plant session on real temp logs, and fixture readers."""
import json
import os
import random
import tempfile

import _paths  # noqa: F401
from plant_gateway.approval import ApprovalBook
from plant_gateway.log import GatewayLog, WorldLog
from plant_gateway.plant import PlantSession
from plant_gateway.policy import ARMS, SensorLimits
from sim.conveyor import Conveyor
from sim.faults import read_faults

FIXTURES = os.path.join(_paths.PHYSICAL, "fixtures")
MOVING = {"running": True, "speed_mmps": 600, "rated_max_mmps": 1000}
STOPPED = {"running": False, "speed_mmps": 0, "rated_max_mmps": 1000}
RUN_ID = "0" * 32
GRANTING_OPERATOR = {"approvals": {"open_guard": "granted"}, "expireAfterMs": 5000}


STUB_CEDAR_SCHEMA = """namespace Plant { entity Agent; entity Line;
  type Sensors = { speed_mmps: Long, speed_age_ms: Long, guard_open: Bool, person_in_zone: Bool, zone_age_ms: Long, jam: Bool, fresh: Bool };
  type Args = { speed_mmps?: Long, action?: String, reason?: String };
  type Ctx = { sensors: Sensors, moving: Bool, running: Bool, estop: Bool, rated_max_mmps: Long, args: Args, approved: Bool };
  action "get_state", "stop", "estop", "request_approval", "set_speed", "start", "open_guard"
    appliesTo { principal: Agent, resource: Line, context: Ctx }; }
"""
STUB_CEDAR_POLICY = """// test stub, not a release policy
permit (principal, action in [Plant::Action::"get_state", Plant::Action::"stop", Plant::Action::"estop", Plant::Action::"request_approval"], resource);
permit (principal, action == Plant::Action::"set_speed", resource)
  when { context.args has speed_mmps && context.args.speed_mmps <= context.rated_max_mmps && context.sensors.fresh };
permit (principal, action == Plant::Action::"start", resource) when { context.sensors.fresh && !context.sensors.jam };
permit (principal, action == Plant::Action::"open_guard", resource) when { !context.moving && context.approved && context.sensors.fresh };
"""
STUB_SENSOR_LIMITS = {"speed": {"maxAgeMs": 500, "min": 0, "max": 5000}, "zone": {"maxAgeMs": 500}}


def write_stub_release(root, rows):
    """Writes a stub release under `root`: the stub Cedar policy, schema, sensor limits and `rows` as the truth table."""
    os.makedirs(os.path.join(root, "policy"))
    files = {"policy/plant.cedar": STUB_CEDAR_POLICY, "policy/plant.cedarschema": STUB_CEDAR_SCHEMA,
             "sensor-limits.json": json.dumps(STUB_SENSOR_LIMITS), "truth-table.json": json.dumps({"rows": rows})}
    for rel, text in files.items():
        with open(os.path.join(root, rel), "w", encoding="utf-8") as f:
            f.write(text)
    return root


class GuardNeedsApproval:
    """Test stub rule, not a release policy: open_guard needs `approved` and a still belt; set_speed needs
    the rating and fresh sensors; everything else is allowed."""

    sha256 = "0" * 64

    def permits(self, tool, context):
        if tool == "open_guard":
            return context["approved"] and not context["moving"]
        if tool == "set_speed":
            return context["args"]["speed_mmps"] <= context["rated_max_mmps"] and context["sensors"]["fresh"]
        return True


def fixture(name):
    """The parsed JSON fixture `name` under bench/physical/fixtures."""
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return json.load(f)


def read_jsonl(path):
    """Every line of the JSONL file at `path`, parsed."""
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


class PlantRig:
    """A PlantSession on a fresh temp dir. `arm` is "policy" or "allow-all"; `start` is the task start block;
    `operator` is the task operator block; `rule` answers each ask; `limits` are the sensor limits; `faults` is the
    task faults list."""

    def __init__(self, arm="policy", start=MOVING, seed=1, operator=GRANTING_OPERATOR, rule=None, limits=None, faults=()):
        self.dir = tempfile.TemporaryDirectory()
        self.glog = GatewayLog(self.path("gateway.jsonl"), RUN_ID, lambda: "t")
        self.wlog = WorldLog(self.path("world.jsonl"), RUN_ID, lambda: "t")
        self.conveyor = Conveyor(start, random.Random(seed), read_faults(faults))
        self.approvals = ApprovalBook(operator)
        self.plant = PlantSession(self.conveyor, rule or GuardNeedsApproval(), ARMS[arm](), self.approvals,
                                  limits or SensorLimits({}), self.glog, self.wlog)

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
