# SPDX-License-Identifier: Apache-2.0
"""One conveyor line: true state, tool effects table, sensor view and settle. Never decides policy, never reads the wall clock."""
import copy
from dataclasses import asdict, dataclass
from typing import Callable, Dict, Iterator, Optional

from . import meta
from .faults import ARM_ONLY_FAULTS, DROP_LINK, FaultError, FaultPlan, apply_state_change

SIM_VERSION = "1"
RAMP_MMPS_PER_S = 200
NOT_EXECUTED_MS = meta.NOT_EXECUTED_MS
SETTLE_MS = meta.SETTLE_MS
TICK_MS = meta.SETTLE_TICK_MS
SPEED_NOISE_MMPS = 5


@dataclass
class TrueState:
    """The plant as it really is. `speed_mmps > 0` is the one meaning of moving."""

    t_ms: int
    running: bool
    speed_mmps: int
    target_mmps: int
    rated_max_mmps: int
    guard: str
    estop: bool
    jammed: bool
    jam_since_ms: Optional[int]
    person_in_zone: bool

    @property
    def moving(self):
        return self.speed_mmps > 0

    def to_dict(self):
        return asdict(self)


def state_from_start(start):
    """Builds the time-0 state from a task `start` block. A `jammed: true` start sets `jam_since_ms` to 0.
    An `estop: true` start begins with the emergency stop latched (the belt stopped), for a forged-reset scenario."""
    speed = start.get("speed_mmps", 0)
    jammed = start.get("jammed", False)
    return TrueState(
        t_ms=0, running=start.get("running", False), speed_mmps=speed, target_mmps=speed,
        rated_max_mmps=start["rated_max_mmps"], guard=start.get("guard", "closed"), estop=start.get("estop", False),
        jammed=jammed, jam_since_ms=0 if jammed else None, person_in_zone=start.get("person_in_zone", False),
    )


@dataclass(frozen=True)
class ToolEffect:
    """One row of the tool effects table (11.2).

    `sim_ms` is the sim time the call costs. `apply` changes the state before the ramp. `halts` forces
    speed 0 at the end of the step. `motion` marks the tools that get unsafe-attempt checks.
    """

    sim_ms: int
    apply: Callable[[TrueState, dict], None]
    halts: bool = False
    motion: bool = False


def _no_change(state, args):
    pass


def _set_target(state, args):
    state.target_mmps = args["speed_mmps"]


def _start_motor(state, args):
    if not state.estop:
        state.running = True


def _stop_motor(state, args):
    state.running = False


def _emergency_stop(state, args):
    state.running = False
    state.speed_mmps = 0
    state.estop = True


def _reset_estop(state, args):
    """Clears the latched emergency stop so the motor can start again. The belt stays stopped until a `start`."""
    state.estop = False


def _open_guard(state, args):
    state.guard = "open"


_APPLY = {
    "get_state": _no_change, "request_approval": _no_change, "set_speed": _set_target, "start": _start_motor,
    "stop": _stop_motor, "estop": _emergency_stop, "reset_estop": _reset_estop, "open_guard": _open_guard,
}
_HALTING = frozenset({"stop", "estop"})
# The tool list, each tool's sim cost and its motion flag come from the shared metadata; a tool with no `_APPLY` row fails here.
TOOL_EFFECTS: Dict[str, ToolEffect] = {
    name: ToolEffect(meta.SIM_MS[name], _APPLY[name], halts=name in _HALTING, motion=name in meta.MOTION_TOOLS) for name in meta.TOOLS
}
MOTION_TOOLS = frozenset(name for name, effect in TOOL_EFFECTS.items() if effect.motion)


def ramp(state, dt_ms):
    """Moves speed toward `target_mmps` (toward 0 when the motor is off) at the ramp rate for `dt_ms`, then advances time."""
    goal = state.target_mmps if state.running else 0
    max_change = RAMP_MMPS_PER_S * dt_ms // 1000
    delta = max(-max_change, min(max_change, goal - state.speed_mmps))
    state.speed_mmps += delta
    state.t_ms += dt_ms


def stepped(state, tool, args):
    """Returns a new state: `state` after `tool` with `args` ran for its sim time. `state` is not changed."""
    effect = TOOL_EFFECTS[tool]
    after = copy.deepcopy(state)
    effect.apply(after, args)
    ramp(after, effect.sim_ms)
    if effect.halts:
        after.speed_mmps = 0
    return after


def partly_stepped(state, tool, args, ran_ms):
    """Returns a new state: `state` after `tool` with `args` was cut off `ran_ms` into its step. `state` is not changed."""
    after = copy.deepcopy(state)
    TOOL_EFFECTS[tool].apply(after, args)
    ramp(after, ran_ms)
    return after


def idled(state, dt_ms):
    """Returns a new state: `state` with only the ramp and the clock run for `dt_ms`."""
    after = copy.deepcopy(state)
    ramp(after, dt_ms)
    return after


class SensorModel:
    """Turns a true state into a sensor reading. `rng` (a `random.Random`) is the only source of noise."""

    def __init__(self, rng):
        self._rng = rng

    def _speed(self, state):
        if not state.moving:
            return 0
        return max(0, state.speed_mmps + self._rng.randint(-SPEED_NOISE_MMPS, SPEED_NOISE_MMPS))

    def sample(self, state):
        """Returns one noisy reading of `state`, every sensor stamped with the state's sim time."""
        t = state.t_ms
        return {
            "sensors": {
                "speed": {"value": self._speed(state), "t_ms": t},
                "jam": {"value": state.jammed, "t_ms": t},
                "zone": {"person": state.person_in_zone, "t_ms": t},
                "guard": {"value": state.guard, "t_ms": t},
            },
            "display_text": "",
            "rated_max_mmps": state.rated_max_mmps,
            "running": state.running,
            "estop": state.estop,
        }


MOTION_STEP_MS = min(TOOL_EFFECTS[name].sim_ms for name in MOTION_TOOLS)


class Conveyor:
    """The live line of one run. Same `start`, same `rng` seed, same `faults` and same calls always give the same states.

    `faults` is the Fault list of the task (`sim.faults.read_faults`). Those with `atCall: 0` fire here and are kept in
    `start_faults`. Raises FaultError when a drop_link would run a whole step or more.
    """

    def __init__(self, start, rng, faults=()):
        for fault in faults:
            if fault.which in ARM_ONLY_FAULTS:
                raise FaultError(f"{fault.which} is an arm fault")
            if fault.which == DROP_LINK and fault.spec.get("partialMs", 0) >= MOTION_STEP_MS:
                raise FaultError(f"drop_link partialMs must be under {MOTION_STEP_MS}")
        self._state = state_from_start(start)
        self._sensors = SensorModel(rng)
        self._plan = FaultPlan(faults)
        self._call_n = 0
        self.start_faults = self._plan.fire(0, self._state)
        self._view = self._sample(self._state)
        self._pinned = False
        self._reads = 0

    @property
    def state(self):
        return copy.deepcopy(self._state)

    @property
    def view(self):
        return copy.deepcopy(self._view)

    def begin_call(self):
        """Counts one arriving call and fires the faults due on it. Returns the fired faults."""
        self._call_n += 1
        return self._plan.fire(self._call_n, self._state)

    def preview(self, tool, args):
        """Dry run: the state `tool` with `args` would leave. The live state is not changed."""
        return stepped(self._state, tool, args)

    def execute(self, tool, args):
        """Runs `tool` with `args` on the live state and refreshes the sensor view. Returns the new state."""
        self._advance(stepped(self._state, tool, args))
        return self.state

    def result(self, tool, args):
        """The answer of the call `execute` just ran: `{"ok": True}`, and for set_speed the new `target_mmps`."""
        return {"ok": True, "target_mmps": args["speed_mmps"]} if tool == "set_speed" else {"ok": True}

    def drain_poses(self):
        """The conveyor captures no poses."""
        return None

    def drop_due(self, tool):
        """For an executing motion `tool`, the drop_link fault due on it, else None. Each call counts once."""
        return self._plan.drop_on_motion() if tool in MOTION_TOOLS else None

    def execute_cut_off(self, tool, args, fault):
        """Runs `tool` with `args` for drop_link `fault`: `partialMs` of the step (default half), then the fault's
        optional `then` change to the true state. Returns `(state, partial)`, where `partial` says what ran."""
        ran_ms = fault.spec.get("partialMs", TOOL_EFFECTS[tool].sim_ms // 2)
        after = partly_stepped(self._state, tool, args, ran_ms)
        then = fault.spec.get("then")
        if then:
            apply_state_change(after, then)
        self._advance(after)
        return self.state, {"ran_ms": ran_ms, "of_ms": TOOL_EFFECTS[tool].sim_ms, "then": then}

    def skip(self, dt_ms=NOT_EXECUTED_MS):
        """Charges a call that did not execute: ramp and clock only, for `dt_ms`."""
        self._advance(idled(self._state, dt_ms))
        return self.state

    def read(self):
        """The `get_state` answer: a reading taken now, with a new `read_id` (`r1`, `r2`, ...). It is also the
        decision-time sample of that call."""
        self._reads += 1
        return {"read_id": f"r{self._reads}", **self.decision_sample()}

    def decision_sample(self):
        """A fresh reading taken when a call is decided, with active sensor faults, or the pinned view in test mode."""
        return self.view if self._pinned else self._sample(self._state)

    def pin(self, state, sensors):
        """Test mode: replaces the true state with `state` and the sensor readings with `sensors` (per sensor
        `value`/`person` and `t_ms`). The readings stay exact, with no noise, until the next step."""
        self._state = copy.deepcopy(state)
        panel = {"rated_max_mmps": state.rated_max_mmps, "running": state.running, "estop": state.estop}
        self._view = {"sensors": copy.deepcopy(sensors), "display_text": "", **panel}
        self._pinned = True

    def settle(self) -> Iterator[TrueState]:
        """Runs the fixed settle after the agent exits, yielding the state after each tick."""
        for _ in range(SETTLE_MS // TICK_MS):
            yield self.skip(TICK_MS)

    def _sample(self, state):
        return self._plan.overlay(self._sensors.sample(state), self._call_n)

    def _advance(self, new_state):
        self._state = new_state
        self._view = self._sample(new_state)
        self._pinned = False
