# SPDX-License-Identifier: Apache-2.0
"""Runs the arm for a stretch of sim time: the speed profile along a straight line, contacts, the keep-out box and pose capture."""
import math

from .arm_body import CONTROL_HZ, ArmBody, ticks_in
from .arm_kinematics import inside_keepout

ACCEL_MMPS2 = 800
TICK_S = 1 / CONTROL_HZ
ARRIVE_MM = 0.5
MAX_POSES = 900


class PoseLog:
    """The poses captured during a run: `(t_ms, qpos)` pairs, at most `limit` of them.

    Once full it drops further poses and sets `capped`, so the world log says the run was cut off (FR-40).
    """

    def __init__(self, limit=MAX_POSES):
        self._limit = limit
        self._pending = []
        self.captured = 0
        self.capped = False

    def add(self, t_ms, qpos):
        """Keeps one pose taken at sim time `t_ms`, unless the log is full."""
        if self.captured >= self._limit:
            self.capped = True
            return
        self._pending.append((t_ms, qpos))
        self.captured += 1

    def drain(self):
        """The poses kept since the last drain as `{"t_ms": [...], "qpos": [[...], ...]}`, or None when there are none."""
        if not self._pending:
            return None
        times, poses = zip(*self._pending)
        self._pending = []
        return {"t_ms": list(times), "qpos": list(poses)}


def _toward(command_mm, goal_mm, step_mm):
    """The point `step_mm` closer to `goal_mm` along the straight line from `command_mm`."""
    gap = [g - c for g, c in zip(goal_mm, command_mm)]
    length = math.sqrt(sum(d * d for d in gap))
    return [c + d * step_mm / length for c, d in zip(command_mm, gap)]


def _next_speed(speed, cap, gap_mm):
    """The speed after one tick: up by the acceleration, never above `cap`, never faster than the hand can stop within `gap_mm`."""
    return min(speed + ACCEL_MMPS2 * TICK_S, cap, math.sqrt(2 * ACCEL_MMPS2 * gap_mm))


def advance(state, body: ArmBody, ms, poses=None):
    """Runs `ms` of sim time on `state` (changed in place) and `body`.

    A move runs while `state.running`: the commanded point travels the straight line to `goal_mm` at up to
    `target_mmps`, and the tip follows it through the physics. A contact deeper than 1 mm stops the move and sets
    `jammed`. While `jammed`, a started move still drives (so `peak_mmps` is above 0) but the point does not advance.
    `poses` (a PoseLog) captures the pose of every tick that moves, and the last tick of the step.
    """
    body.set_intruder(state.intruder_mm)
    command = [u / 1000 for u in state.command_um]
    speed = float(state.speed_mmps)
    peak = 0.0
    entered = False
    ticks = ticks_in(ms)
    for tick in range(ticks):
        driving = state.running and not state.estop
        if driving:
            gap = math.dist(command, state.goal_mm)
            speed = _next_speed(speed, state.target_mmps, gap)
            peak = max(peak, speed)
            if gap <= max(speed * TICK_S, ARRIVE_MM):
                command, speed, state.running = [float(v) for v in state.goal_mm], 0.0, False
            elif not state.jammed:
                command = _toward(command, state.goal_mm, speed * TICK_S)
        else:
            speed = 0.0
        body.tick(command, state.gripper_mm, state.holding)
        tip = body.tip_mm()
        entered = entered or inside_keepout(tip)
        if driving and not state.jammed and body.arm_pushes_on_scene():
            _stall(state, tip, state.t_ms + (tick + 1) * 1000 // CONTROL_HZ)
            command, speed = [float(v) for v in state.goal_mm], 0.0
        if poses is not None and (driving or body.block_is_moving() or tick == ticks - 1):
            poses.add(state.t_ms + (tick + 1) * 1000 // CONTROL_HZ, body.pose())
    _finish_step(state, body, ms, command, speed, peak, entered)


def _stall(state, tip, now_ms):
    """A contact stops the move at the tip: `jammed` from `now_ms`, goal and command at the tip."""
    state.jammed, state.jam_since_ms, state.running = True, now_ms, False
    state.goal_mm = [round(v) for v in tip]


def _finish_step(state, body, ms, command, speed, peak, entered):
    """Writes the end-of-step readings into `state` and moves its clock on by `ms`."""
    state.command_um = [round(v * 1000) for v in command]
    state.hand_mm = [round(v) for v in body.tip_mm()]
    state.speed_mmps = 0 if state.jammed else round(speed)
    state.peak_mmps = round(peak)
    state.in_keepout = entered
    state.block_mm = [round(v) for v in body.block_mm()]
    state.block_in_tray = body.block_in_tray()
    state.t_ms += ms
