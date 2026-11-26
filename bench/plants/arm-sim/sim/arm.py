# SPDX-License-Identifier: Apache-2.0
"""One arm cell: true state, tool effects, sensor view and settle, on a MuJoCo model. Never decides policy, never reads the wall clock."""
import copy
from typing import Iterator

from . import arm_scene as scene
from .arm_body import ArmBody
from .arm_kinematics import Unreachable, joint_angles
from .arm_meta import ARM_META
from .arm_motion import PoseLog, advance
from .arm_sensors import ArmSensorModel
from .arm_state import ArmState, state_from_start
from .faults import DROP_LINK, FaultError, FaultPlan, apply_state_change
from .meta import SETTLE_MS, SETTLE_TICK_MS

MIN_HOLD_N = 5
GRASP_REACH_MM = 12
PATH_SAMPLES = 16
MOVE_TO, SET_SPEED, SET_GRIPPER, OPEN_DOOR, STOP, ESTOP = "move_to", "set_speed", "set_gripper", "open_door", "stop", "estop"
MOTION_STEP_MS = min(ARM_META.sim_ms[name] for name in ARM_META.motion_tools)


def _refused(reason):
    return {"ok": False, "reason": reason}


def _path_is_reachable(start_mm, goal_mm):
    """None when the whole straight line from `start_mm` to `goal_mm` is reachable, else the reason it is not."""
    for i in range(PATH_SAMPLES + 1):
        point = [a + (b - a) * i / PATH_SAMPLES for a, b in zip(start_mm, goal_mm)]
        try:
            joint_angles(*point)
        except Unreachable as e:
            return str(e)
    return None


def _move_to(state, body, args):
    if state.estop:
        return _refused("estop")
    goal = [args["x_mm"], args["y_mm"], args["z_mm"]]
    why = _path_is_reachable([u / 1000 for u in state.command_um], goal)
    if why:
        return _refused(why)
    state.goal_mm, state.running = goal, True
    return {"ok": True}


def _set_speed(state, body, args):
    state.target_mmps = args["speed_mmps"]
    return {"ok": True, "target_mmps": state.target_mmps}


def _near_block(state, body):
    tip, block = body.tip_mm(), body.block_mm()
    return abs(tip[0] - block[0]) <= GRASP_REACH_MM and abs(tip[1] - block[1]) <= GRASP_REACH_MM and abs(tip[2] - block[2]) <= GRASP_REACH_MM


def _set_gripper(state, body, args):
    """Sets the finger width. Closing to the block's width on the block, with at least MIN_HOLD_N, holds it; opening lets it go."""
    state.gripper_mm = args["width_mm"]
    closing_on_block = args["width_mm"] <= scene.BLOCK_SIZE_MM + 2 and not state.holding and _near_block(state, body)
    if closing_on_block and args["force_n"] >= MIN_HOLD_N:
        state.holding, state.grip_force_n = True, args["force_n"]
    elif args["width_mm"] > scene.BLOCK_SIZE_MM + 2:
        state.holding, state.grip_force_n = False, 0
    return {"ok": True, "holding": state.holding}


def _open_door(state, body, args):
    state.guard = "open"
    return {"ok": True}


def _stop(state, body, args):
    state.running = False
    state.goal_mm = [round(u / 1000) for u in state.command_um]
    return {"ok": True}


def _emergency_stop(state, body, args):
    _stop(state, body, args)
    state.estop = True
    return {"ok": True}


def _no_change(state, body, args):
    return {"ok": True}


_APPLY = {
    "get_state": _no_change, "request_approval": _no_change, SET_SPEED: _set_speed, MOVE_TO: _move_to,
    SET_GRIPPER: _set_gripper, STOP: _stop, ESTOP: _emergency_stop, OPEN_DOOR: _open_door,
}
if set(_APPLY) != set(ARM_META.tools):
    raise ImportError(f"arm tool effects {sorted(_APPLY)} differ from the metadata tools {sorted(ARM_META.tools)}")


class Arm:
    """The live cell of one run. Same `start`, same `rng` seed, same `faults` and same calls always give the same states.

    `start` is the task start block (see `state_from_start`; `hand_mm` sets the first tip position, default HOME_MM).
    `rng` (a `random.Random`) places the block within BLOCK_JITTER_MM of its nominal spot and is the only source of
    sensor noise. `faults` is the Fault list of the task. Raises FaultError when a drop_link would run a whole step or more.
    """

    def __init__(self, start, rng, faults=()):
        for fault in faults:
            if fault.which == DROP_LINK and fault.spec.get("partialMs", 0) >= MOTION_STEP_MS:
                raise FaultError(f"drop_link partialMs must be under {MOTION_STEP_MS}")
        jitter = scene.BLOCK_JITTER_MM
        block_xy = [v + rng.randint(-jitter, jitter) for v in scene.BLOCK_START_MM]
        self._body = ArmBody(block_xy)
        hand = list(start.get("hand_mm", scene.HOME_MM))
        self._body.place_hand(hand, scene.GRIPPER_OPEN_MM)
        self._state = state_from_start(start, hand, [*block_xy, scene.BLOCK_SIZE_MM // 2])
        self._sensors = ArmSensorModel(rng)
        self._plan = FaultPlan(faults)
        self._poses = PoseLog()
        self._call_n = 0
        self._result = {"ok": True}
        self.start_faults = self._plan.fire(0, self._state)
        self._view = self._sample(self._state)
        self._pinned = False
        self._reads = 0
        self._poses.add(0, self._body.pose())

    @property
    def state(self):
        return copy.deepcopy(self._state)

    @property
    def view(self):
        return copy.deepcopy(self._view)

    @property
    def poses_capped(self):
        """True once the run has more poses than the log keeps."""
        return self._poses.capped

    def begin_call(self):
        """Counts one arriving call and fires the faults due on it. Returns the fired faults."""
        self._call_n += 1
        return self._plan.fire(self._call_n, self._state)

    def preview(self, tool, args):
        """Dry run: the state `tool` with `args` would leave. The live state and physics are not changed."""
        after = copy.deepcopy(self._state)
        with self._body.sandbox():
            self._run(after, tool, args, ARM_META.sim_ms[tool], poses=None)
        return after

    def execute(self, tool, args):
        """Runs `tool` with `args` on the live state and refreshes the sensor view. Returns the new state."""
        after = copy.deepcopy(self._state)
        self._result = self._run(after, tool, args, ARM_META.sim_ms[tool], poses=self._poses)
        self._advance(after)
        return self.state

    def result(self, tool, args):
        """The answer of the call `execute` ran last (`{"ok": ...}` and any detail the tool adds)."""
        return dict(self._result)

    def drain_poses(self):
        """The poses captured since the last call as `{"t_ms": [...], "qpos": [[...]]}`, or None when there are none."""
        return self._poses.drain()

    def drop_due(self, tool):
        """For an executing motion `tool`, the drop_link fault due on it, else None. Each call counts once."""
        return self._plan.drop_on_motion() if tool in ARM_META.motion_tools else None

    def execute_cut_off(self, tool, args, fault):
        """Runs `tool` with `args` for drop_link `fault`: `partialMs` of the step (default half), then the fault's
        optional `then` change to the true state. Returns `(state, partial)`, where `partial` says what ran."""
        full_ms = ARM_META.sim_ms[tool]
        ran_ms = fault.spec.get("partialMs", full_ms // 2)
        after = copy.deepcopy(self._state)
        self._run(after, tool, args, ran_ms, poses=self._poses)
        then = fault.spec.get("then")
        if then:
            apply_state_change(after, then)
        self._advance(after)
        return self.state, {"ran_ms": ran_ms, "of_ms": full_ms, "then": then}

    def skip(self, dt_ms=ARM_META.not_executed_ms):
        """Charges a call that did not execute: the motion in progress and the clock only, for `dt_ms`."""
        after = copy.deepcopy(self._state)
        advance(after, self._body, dt_ms, self._poses)
        self._advance(after)
        return self.state

    def read(self):
        """The `get_state` answer: a reading taken now, with a new `read_id` (`r1`, `r2`, ...)."""
        self._reads += 1
        return {"read_id": f"r{self._reads}", **self.decision_sample()}

    def decision_sample(self):
        """A fresh reading taken when a call is decided, with active sensor faults, or the pinned view in test mode."""
        return self.view if self._pinned else self._sample(self._state)

    def pin(self, state, sensors):
        """Test mode: replaces the true state with `state` and builds the sensor view from it with no noise, then sets
        each sensor named in `sensors` (a dict of `speed`/`jam`/`zone`/`guard` readings) as given. The physics is
        not moved."""
        self._state = copy.deepcopy(state)
        view = self._sensors.exact_sample(state)
        view["sensors"].update(copy.deepcopy(sensors))
        self._view = view
        self._pinned = True

    def settle(self) -> Iterator[ArmState]:
        """Runs the fixed settle after the agent exits, yielding the state after each tick."""
        for _ in range(SETTLE_MS // SETTLE_TICK_MS):
            yield self.skip(SETTLE_TICK_MS)

    def _run(self, state, tool, args, ms, poses):
        """Applies `tool` to `state` and runs `ms` of sim time. Returns the tool's result."""
        result = _APPLY[tool](state, self._body, args)
        advance(state, self._body, ms, poses)
        return result

    def _sample(self, state):
        return self._plan.overlay(self._sensors.sample(state), self._call_n)

    def _advance(self, new_state):
        self._state = new_state
        self._view = self._sample(new_state)
        self._pinned = False
