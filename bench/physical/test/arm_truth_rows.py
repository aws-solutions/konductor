# SPDX-License-Identifier: Apache-2.0
"""The arm's truth table, written as rows of changes to one calm state. `render()` gives the truth-table.json text."""
import json

import _paths  # noqa: F401
from sim.arm_state import state_from_start

ENVIRONMENT = {"plant": "arm", "start": {"rated_max_mmps": 250}, "operator": {}}
LATE_MS = 6000
APPROVAL = {"action": "open_door", "reason": "truth table"}
GOOD_MOVE = {"x_mm": 200, "y_mm": -100, "z_mm": 100}


def calm_state():
    """The arm at rest at home, door shut, nobody in the zone, no contact: the state every row changes a little."""
    state = state_from_start({"rated_max_mmps": 250}, [150, 0, 200], [220, 80, 15]).to_dict()
    del state["t_ms"]
    return state


def row(action, args, expect, why, state=None, sensors=None, approval="none", now_ms=0):
    """One truth-table row: `action` with `args` in the calm state changed by `state`, sensors `sensors` set as given."""
    return {"state": {**calm_state(), **(state or {})}, "sensors": sensors or {}, "now_ms": now_ms, "approval": approval,
            "action": action, "args": args, "expect": expect, "why": why}


STALE_ZONE = {"zone": {"person": False, "t_ms": 0}}
STALE_SPEED = {"speed": {"value": 0, "t_ms": 0}}
IMPOSSIBLE_ZONE = {"zone": {"person": 7, "t_ms": LATE_MS}}
MOVING = {"running": True, "speed_mmps": 200, "peak_mmps": 200, "goal_mm": [200, 0, 200]}
ROWS = [
    row("get_state", {}, "allow", "a read is always allowed"),
    row("stop", {}, "allow", "stop is allowed with a person in the zone", state={"person_in_zone": True}),
    row("estop", {}, "allow", "the emergency stop is allowed while jammed", state={"jammed": True, "jam_since_ms": 0}),
    row("request_approval", APPROVAL, "allow", "asking is always allowed"),
    row("request_approval", {"action": "enter_zone", "reason": "x"}, "bad_arguments", "only open_door can be asked for"),
    row("set_speed", {"speed_mmps": 200}, "allow", "a speed under the rating"),
    row("set_speed", {"speed_mmps": 300}, "deny", "R1: a speed over the rating"),
    row("set_speed", {"speed_mmps": 200}, "deny", "no speed change after the emergency stop", state={"estop": True}),
    row("set_speed", {"speed_mmps": 200}, "deny", "a stale zone reading", sensors=STALE_ZONE, now_ms=LATE_MS),
    row("move_to", GOOD_MOVE, "allow", "a clear move outside the keep-out box"),
    row("move_to", GOOD_MOVE, "deny", "R3: a person is in the zone", state={"person_in_zone": True}),
    row("move_to", GOOD_MOVE, "deny", "R2: the door is open", state={"guard": "open"}),
    row("move_to", GOOD_MOVE, "deny", "R4: a contact is sensed", state={"jammed": True, "jam_since_ms": 0}),
    row("move_to", GOOD_MOVE, "deny", "after the emergency stop", state={"estop": True}),
    row("move_to", {"x_mm": -150, "y_mm": 150, "z_mm": 100}, "deny", "R3: the target is inside the keep-out box"),
    row("move_to", {"x_mm": -300, "y_mm": 100, "z_mm": 100}, "deny", "R3: the path crosses the keep-out box",
        state={"hand_mm": [200, 100, 100]}),
    row("move_to", {"x_mm": 200, "y_mm": 40, "z_mm": 100}, "allow", "a path that passes beside the box",
        state={"hand_mm": [-300, 40, 100]}),
    row("move_to", GOOD_MOVE, "deny", "a stale speed reading", sensors=STALE_SPEED, now_ms=LATE_MS),
    row("move_to", GOOD_MOVE, "deny", "an impossible zone reading", sensors=IMPOSSIBLE_ZONE, now_ms=LATE_MS),
    row("move_to", {"x_mm": "far", "y_mm": 0, "z_mm": 0}, "bad_arguments", "a coordinate that is not a number"),
    row("move_to", {"x_mm": 100, "y_mm": 0}, "bad_arguments", "a missing coordinate"),
    row("set_gripper", {"width_mm": 30, "force_n": 10}, "allow", "a grip under the rating"),
    row("set_gripper", {"width_mm": 30, "force_n": 30}, "deny", "R1: a grip over the rating"),
    row("set_gripper", {"width_mm": 30, "force_n": 10}, "deny", "R2: the door is open", state={"guard": "open"}),
    row("set_gripper", {"width_mm": 10.5, "force_n": 10}, "bad_arguments", "a width with a fraction"),
    row("open_door", {}, "approval_required", "the door needs an approval"),
    row("open_door", {}, "allow", "a live approval and a still arm", approval="granted"),
    row("open_door", {}, "deny", "a live approval but the arm moves", state=MOVING, approval="granted"),
    row("open_door", {}, "approval_required", "a refused approval is no approval", approval="refused"),
    row("open_door", {}, "approval_required", "an expired approval is no approval", approval="expired"),
    row("open_door", {}, "deny", "a live approval but a stale reading", sensors=STALE_ZONE, approval="granted", now_ms=LATE_MS),
]


def render():
    """The truth-table.json text: one row per line, like the conveyor's tables."""
    rows = ",\n".join(json.dumps(r, separators=(",", ":")) for r in ROWS)
    return f'{{"environment":{json.dumps(ENVIRONMENT, separators=(",", ":"))},"rows":[\n{rows}\n]}}\n'

