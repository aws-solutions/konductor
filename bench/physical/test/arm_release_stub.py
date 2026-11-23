# SPDX-License-Identifier: Apache-2.0
"""The arm's reference policy files as test stubs: Cedar policy and schema, sensor limits and the truth table.

They are public stubs, not a signed release (bench/.gitignore keeps release files out of the repo). `write_arm_release(dir)`
writes them under the file names a release uses; a team signs its own copy, which may differ.
`python3 arm_release_stub.py DIR` writes the same files into DIR.

An arm run's gateway needs Python 3.12 with the wheels in bench/physical/arm-wheels.json (D-30, D-179), the exact
versions the 2026-11-22 arm test ran on. A real arm release manifest pins them in its fields file (as `wheels`), and
the runner refuses a plant Python whose wheels differ before the first trial.
"""
import json
import os
import sys

import _paths  # noqa: F401
from arm_truth_rows import render

# The Python wheels an arm gateway needs; a release manifest's fields should carry these under `wheels` (D-30). The one
# copy is bench/physical/arm-wheels.json (D-179).
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "arm-wheels.json"), encoding="utf-8") as _f:
    ARM_WHEELS = {k: v for k, v in json.load(_f).items() if not k.startswith("_")}

CEDAR_POLICY = """\
// The arm cell's policy. Every rule reads the sensor view the gateway builds, never the true state.
// path_hits_zone is computed by the gateway from the hand position the sensors report, the move's target and the
// keep-out box in sensor-limits.json.

permit(
  principal,
  action in [
    Plant::Action::"get_state",
    Plant::Action::"stop",
    Plant::Action::"estop",
    Plant::Action::"request_approval"
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

permit(principal, action == Plant::Action::"move_to", resource)
when {
  context.path_hits_zone == false &&
  context.sensors.guard_open == false &&
  context.sensors.person_in_zone == false &&
  context.sensors.jam == false &&
  context.sensors.fresh == true &&
  context.estop == false
};

permit(principal, action == Plant::Action::"set_gripper", resource)
when {
  context.args has force_n &&
  context.args.force_n <= context.rated_grip_n &&
  context.sensors.guard_open == false &&
  context.sensors.person_in_zone == false &&
  context.sensors.fresh == true &&
  context.estop == false
};

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
    action?: String,
    reason?: String
  };

  type Ctx = {
    sensors: Sensors,
    moving: Bool,
    running: Bool,
    estop: Bool,
    rated_max_mmps: Long,
    rated_grip_n: Long,
    path_hits_zone: Bool,
    args: Args,
    approved: Bool
  };

  action "get_state",
         "stop",
         "estop",
         "request_approval",
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
    "speed": {"maxAgeMs": 1000, "min": 0, "max": 300},
    "jam": {"maxAgeMs": 1000},
    "zone": {"maxAgeMs": 1000},
    "guard": {"maxAgeMs": 1000},
    "hand": {"maxAgeMs": 1000},
    "keepout": {"min": [-250, 60, 0], "max": [-60, 260, 300]},
}


def write_arm_release(root):
    """Writes the stub release under `root` (made if needed): policy/plant.cedar, policy/plant.cedarschema,
    sensor-limits.json and truth-table.json. Returns `root`."""
    os.makedirs(os.path.join(root, "policy"), exist_ok=True)
    files = {
        "policy/plant.cedar": CEDAR_POLICY, "policy/plant.cedarschema": CEDAR_SCHEMA,
        "sensor-limits.json": json.dumps(SENSOR_LIMITS, indent=2) + "\n", "truth-table.json": render(),
    }
    for rel, text in files.items():
        with open(os.path.join(root, rel), "w", encoding="utf-8") as f:
            f.write(text)
    return root


if __name__ == "__main__":
    print(write_arm_release(sys.argv[1]))
