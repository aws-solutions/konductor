# SPDX-License-Identifier: Apache-2.0
"""The arm's Cedar context: the conveyor's context plus the grip rating and whether a move would reach the keep-out box."""
from sim.arm_kinematics import segment_hits_box

from .policy import PolicyInvalid, decision_context

KEEPOUT = "keepout"


def validate_limits(limits):
    """Raises PolicyInvalid unless `limits` (SensorLimits) hold a `keepout` box of two corners with three whole numbers each."""
    box = limits.entry(KEEPOUT)
    corners = [box.get("min"), box.get("max")] if isinstance(box, dict) else []
    if not all(isinstance(c, list) and len(c) == 3 and all(isinstance(v, int) and not isinstance(v, bool) for v in c) for c in corners):
        raise PolicyInvalid("sensor-limits.json needs keepout {min: [x, y, z], max: [x, y, z]} in whole mm")
    if any(lo > hi for lo, hi in zip(*corners)):
        raise PolicyInvalid("sensor-limits.json keepout min is above max")


def path_hits_zone(sample, tool, args, limits):
    """True when `tool` is a move_to whose straight path, from the hand position in the sensor `sample` to the asked
    point, touches the keep-out box in `limits`. Computed from the sensor view and the arguments only, never the true state."""
    if tool != "move_to":
        return False
    box = limits.entry(KEEPOUT)
    goal = [args["x_mm"], args["y_mm"], args["z_mm"]]
    return segment_hits_box(sample["hand_mm"], goal, box["min"], box["max"])


def hand_is_fresh(sample, now_ms, limits):
    """True when the hand position in `sample` is within the `hand` entry's `maxAgeMs` in `limits` (no entry: any age)."""
    return now_ms - sample["hand_t_ms"] <= limits.entry("hand").get("maxAgeMs", float("inf"))


def arm_decision_context(sample, tool, args, now_ms, limits, approved):
    """The Cedar context for `tool` with `args` from the decision-time sensor `sample`, sim time `now_ms`, SensorLimits
    `limits` and the gateway-set `approved` flag: the conveyor's fields, `rated_grip_n` and `path_hits_zone`. `sensors.fresh`
    is also false when the hand position is older than the limit."""
    base = decision_context(sample, args, now_ms, limits, approved)
    fresh = base["sensors"]["fresh"] and hand_is_fresh(sample, now_ms, limits)
    return {
        **base, "sensors": {**base["sensors"], "fresh": fresh},
        "rated_grip_n": sample["rated_grip_n"],
        "path_hits_zone": path_hits_zone(sample, tool, args, limits),
    }
