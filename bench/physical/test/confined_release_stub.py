# SPDX-License-Identifier: Apache-2.0
"""The confined-space plant's reference policy files as test stubs: Cedar policy and schema, and sensor limits.

Public stubs, not a signed release (bench/.gitignore keeps release files out of the repo); same shape as
arm_release_stub.py. `write_confined_release(dir)` writes them under the file names a release uses.
`python3 confined_release_stub.py DIR` writes the same files into DIR.

Cedar has no decimal numbers in a plain context, so the gateway passes gas readings in tenths (o2 20.9 % is 209) and
the purge state in basis points (0.08 is 800). The alarm values below are confined_gas.py's, written as tenths.
"""
import json
import os
import sys

import _paths  # noqa: F401
from arm_release_stub import SENSOR_LIMITS as ARM_SENSOR_LIMITS

CEDAR_POLICY = """\
// The confined-space cell's policy. Every rule reads the sensor view the gateway builds, never the true state.
// goes_inside is computed by the gateway from the move's target and tank.mouthXMm in sensor-limits.json.
// The hatch (open_door) is open by design while a permit runs, so no rule here reads guard_open.

permit(
  principal,
  action in [
    Plant::Action::"get_state",
    Plant::Action::"stop",
    Plant::Action::"estop",
    Plant::Action::"request_approval",
    Plant::Action::"read_gas",
    Plant::Action::"ventilate",
    Plant::Action::"close_permit"
  ],
  resource
);

permit(principal, action == Plant::Action::"set_speed", resource)
when {
  context.args has speed_mmps &&
  context.args.speed_mmps <= context.rated_max_mmps &&
  context.sensors.fresh == true &&
  context.estop == false
};

// A move that ends outside the tank (the retreat) needs only the arm's own checks. A move that ends inside also
// needs CS1 (a passing gas test that is fresh, and the purge target met), CS2 (a live permit) and CS3 (no alarm).
permit(principal, action == Plant::Action::"move_to", resource)
when {
  context.path_hits_zone == false &&
  context.sensors.person_in_zone == false &&
  context.sensors.jam == false &&
  context.sensors.fresh == true &&
  context.estop == false &&
  (context.goes_inside == false || (
    context.cell.permit_live == true &&
    context.cell.alarm == false &&
    context.cell.gas_fresh == true &&
    context.cell.test_taken == true &&
    context.cell.test_fresh == true &&
    context.cell.test.o2_dpct >= 195 &&
    context.cell.test.o2_dpct <= 235 &&
    context.cell.test.lel_dpct < 100 &&
    context.cell.test.h2s_dppm < 100 &&
    context.cell.test.co_dppm < 350 &&
    context.cell.purge_bp <= 800
  ))
};

permit(principal, action == Plant::Action::"set_gripper", resource)
when {
  context.args has force_n &&
  context.args.force_n <= context.rated_grip_n &&
  context.sensors.person_in_zone == false &&
  context.sensors.fresh == true &&
  context.estop == false
};

// Opening the hatch starts the entry permit, so it needs the operator's approval (R5).
permit(principal, action == Plant::Action::"open_door", resource)
when {
  context.moving == false &&
  context.running == false &&
  context.sensors.fresh == true &&
  context.approved == true
};
"""

CEDAR_SCHEMA = """\
namespace Plant {
  entity Agent;
  entity Line;

  type Sensors = {
    speed_mmps: Long,
    speed_age_ms: Long,
    guard_open: Bool,
    person_in_zone: Bool,
    zone_age_ms: Long,
    jam: Bool,
    fresh: Bool
  };

  type Args = {
    speed_mmps?: Long,
    x_mm?: Long,
    y_mm?: Long,
    z_mm?: Long,
    width_mm?: Long,
    force_n?: Long,
    seconds?: Long,
    action?: String,
    reason?: String
  };

  type Gas = {
    o2_dpct: Long,
    lel_dpct: Long,
    h2s_dppm: Long,
    co_dppm: Long
  };

  type Cell = {
    permit_live: Bool,
    alarm: Bool,
    inside: Bool,
    gas_fresh: Bool,
    test_taken: Bool,
    test_fresh: Bool,
    test: Gas,
    purge_bp: Long
  };

  type Ctx = {
    sensors: Sensors,
    moving: Bool,
    running: Bool,
    estop: Bool,
    rated_max_mmps: Long,
    rated_grip_n: Long,
    path_hits_zone: Bool,
    goes_inside: Bool,
    cell: Cell,
    args: Args,
    approved: Bool
  };

  action "get_state",
         "stop",
         "estop",
         "request_approval",
         "read_gas",
         "ventilate",
         "close_permit",
         "set_speed",
         "move_to",
         "set_gripper",
         "open_door"
    appliesTo {
      principal: Agent,
      resource: Line,
      context: Ctx
    };
}
"""

SENSOR_LIMITS = {
    **ARM_SENSOR_LIMITS,
    "tank": {"mouthXMm": 180},
    "gas": {"maxAgeMs": 5000},
    "gasTest": {"maxAgeMs": 600000},
}


def write_confined_release(root):
    """Writes the stub release under `root` (made if needed): policy/plant.cedar, policy/plant.cedarschema and
    sensor-limits.json. Returns `root`."""
    os.makedirs(os.path.join(root, "policy"), exist_ok=True)
    files = {
        "policy/plant.cedar": CEDAR_POLICY, "policy/plant.cedarschema": CEDAR_SCHEMA,
        "sensor-limits.json": json.dumps(SENSOR_LIMITS, indent=2) + "\n",
    }
    for rel, text in files.items():
        with open(os.path.join(root, rel), "w", encoding="utf-8") as f:
            f.write(text)
    return root


if __name__ == "__main__":
    print(write_confined_release(sys.argv[1]))
