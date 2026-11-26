# SPDX-License-Identifier: Apache-2.0
"""The confined-space cell: the bench Arm as is, plus the tank atmosphere, the entry permit and the gas alarm.

Never decides policy and never reads the wall clock. The hatch is the arm's door: `open_door` opens it and starts the
permit (the gateway's approval check and R5 decide whether that was allowed). `read_gas`, `ventilate` and
`close_permit` are the cell's own tools.

shortcut: gas tests and ventilation add sim time with the arm standing still (the cell keeps the extra time and adds
it to every arm time stamp); a slow move in progress does not advance during them. Upgrade when a task needs it.
shortcut: test mode pins the arm only (the control frame is the arm's `set_arm_state`); the permit, test and alarm keep
their live values. A truth table for this kind needs its own control op first.
"""
import copy
import math
import os
from dataclasses import dataclass, fields
from typing import Iterator, Optional

from . import confined_gas as gas
from .arm_state import ArmState
from .meta import PLANTS, SETTLE_MS, SETTLE_TICK_MS, load_meta

SIM_VERSION = "1"
CONFINED_META_PATH = os.path.join(PLANTS, "arm-confined-space", "meta.json")
CONFINED_META = load_meta(CONFINED_META_PATH)
READ_GAS, VENTILATE, CLOSE_PERMIT, OPEN_DOOR = "read_gas", "ventilate", "close_permit", "open_door"
CELL_TOOLS = frozenset({READ_GAS, VENTILATE, CLOSE_PERMIT})
ARM_FIELDS = tuple(f.name for f in fields(ArmState))


@dataclass
class ConfinedState(ArmState):
    """The arm's true state plus the cell's.

    `permit` is none, live, aborted (by an alarm) or closed. `test_t_ms` and `test_pass` are the latest gas test (None
    before the first). `purge_fraction` is the contamination left since the last release. `alarm_since_ms` is when the
    latched alarm began (None: no alarm) and `alarm_reason` why. `inside` says the hand tip is past the tank mouth and
    `inside_ms` for how long, without a break. `spiked` says the staged release fired. `inspected` says the hand
    reached the task's inspection point inside. `monitor_t_ms` is the last meter reading's time.
    """

    permit: str = "none"
    test_t_ms: Optional[int] = None
    test_pass: bool = False
    purge_fraction: float = 1.0
    alarm_since_ms: Optional[int] = None
    alarm_reason: Optional[str] = None
    inside: bool = False
    inside_ms: int = 0
    spiked: bool = False
    inspected: bool = False
    monitor_t_ms: int = 0


class ConfinedCell:
    """One run's cell. Same arm, same gas seed, same `confined` block and same calls always give the same states.

    `arm` is a fresh bench Arm, `gas_field` a GasField. `confined` is the task's `environment.confined` block:
    `spikeAfterInsideMs` (None: no release), `gasDropout` (`{fromCall, untilCall}`: no meter data for those calls, or
    None), `inspectMm` and `tolMm` (the inspection point and how near counts).
    """

    def __init__(self, arm, gas_field, confined):
        self._arm = arm
        self._gas = gas_field
        self._spike_after = confined.get("spikeAfterInsideMs")
        drop = confined.get("gasDropout")
        self._dropout = (drop["fromCall"], drop["untilCall"]) if drop else None
        self._inspect = confined.get("inspectMm")
        self._tol = confined.get("tolMm", 3)
        self._idle_ms = 0
        self._calls = 0
        self._cell = {"permit": "none", "test_t_ms": None, "test_pass": False, "alarm_since_ms": None, "alarm_reason": None,
                      "inside": False, "inside_ms": 0, "spiked": False, "inspected": False, "monitor_t_ms": 0}
        self._meter = None
        self._test = None
        self._result = {"ok": True}
        self.start_faults = arm.start_faults
        self._monitor(self.now_ms)

    # ---- what the gateway reads

    @property
    def now_ms(self):
        return self._arm.state.t_ms + self._idle_ms

    @property
    def state(self):
        return self._as_confined(self._arm.state)

    @property
    def view(self):
        return {**self._shift(self._arm.view), "cell": self._panel()}

    @property
    def poses_capped(self):
        return self._arm.poses_capped

    def read(self):
        """The `get_state` answer: the arm's reading (with its `read_id`) and the cell panel."""
        return {**self._shift(self._arm.read()), "cell": self._panel()}

    def decision_sample(self):
        """The reading a call is decided on: the arm's decision sample and the cell panel."""
        return {**self._shift(self._arm.decision_sample()), "cell": self._panel()}

    def drain_poses(self):
        poses = self._arm.drain_poses()
        if poses:
            poses["t_ms"] = [t + self._idle_ms for t in poses["t_ms"]]
        return poses

    # ---- one call

    def begin_call(self):
        """Counts one arriving call and fires the arm faults due on it. Returns the fired faults."""
        self._calls += 1
        return self._arm.begin_call()

    def preview(self, tool, args):
        """Dry run: the state `tool` with `args` would leave. A cell tool previews as no change."""
        if tool in CELL_TOOLS:
            return self.state
        return self._as_confined(self._arm.preview(tool, args))

    def execute(self, tool, args):
        """Runs `tool` with `args`, then the meter, the release and the alarm. Returns the new state."""
        start = self.now_ms
        if tool in CELL_TOOLS:
            self._result = self._cell_tool(tool, args)
        else:
            self._arm.execute(tool, args)
            self._open_permit_if(tool)
        self._after_call(start)
        return self.state

    def result(self, tool, args):
        return dict(self._result) if tool in CELL_TOOLS else self._arm.result(tool, args)

    def drop_due(self, tool):
        return self._arm.drop_due(tool)

    def execute_cut_off(self, tool, args, fault):
        """An arm motion `tool` cut off by drop_link `fault` (see Arm.execute_cut_off). Returns `(state, partial)`."""
        start = self.now_ms
        _, partial = self._arm.execute_cut_off(tool, args, fault)
        self._open_permit_if(tool)
        self._after_call(start)
        return self.state, partial

    def skip(self, dt_ms=CONFINED_META.not_executed_ms):
        """Charges a call that did not run: the arm's motion and the clock for `dt_ms`, then the meter."""
        start = self.now_ms
        self._arm.skip(dt_ms)
        self._after_call(start)
        return self.state

    def pin(self, state, sensors):
        """Test mode: pins the arm part of `state` and the arm `sensors` (see Arm.pin). The cell keeps its own values."""
        arm_state = ArmState(**{name: copy.deepcopy(getattr(state, name)) for name in ARM_FIELDS})
        arm_state.t_ms = state.t_ms - self._idle_ms
        self._arm.pin(arm_state, sensors)

    def settle(self) -> Iterator[ConfinedState]:
        """The fixed settle after the agent exits, yielding the state after each tick."""
        for _ in range(SETTLE_MS // SETTLE_TICK_MS):
            yield self.skip(SETTLE_TICK_MS)

    # ---- the cell's tools

    def _cell_tool(self, tool, args):
        if tool == READ_GAS:
            return self._read_gas()
        if tool == VENTILATE:
            self._gas.ventilate(args["seconds"])
            self._idle_ms += args["seconds"] * 1000
            return {"ok": True, "purge_fraction": self._purge()}
        self._idle_ms += CONFINED_META.sim_ms[CLOSE_PERMIT]
        self._cell["permit"] = "closed"
        return {"ok": True}

    def _read_gas(self):
        """One gas test. A passing test taken with the hand outside clears a latched alarm."""
        self._idle_ms += gas.READ_GAS_MS
        if self._meter_down():
            return {"ok": False, "reason": "gas_link_down"}
        now = self.now_ms
        reading = self._gas.read()
        failed = gas.failed_gases(reading)
        self._test = {**reading, "t_ms": now}
        self._meter = {**reading, "t_ms": now}
        self._cell.update(test_t_ms=now, test_pass=not failed, monitor_t_ms=now)
        if not failed and not gas.is_inside(self._arm.state.hand_mm):
            self._cell.update(alarm_since_ms=None, alarm_reason=None)
        return {"ok": True, **self._test, "pass": not failed, "failed": failed, "purge_fraction": self._purge(), "purge_target": gas.PURGE_TARGET}

    def _open_permit_if(self, tool):
        if tool == OPEN_DOOR and self._arm.state.guard == "open":
            self._cell["permit"] = "live"

    # ---- after every call and settle tick

    def _after_call(self, start_ms):
        """Advances the inside timer, fires the staged release, takes the meter reading and raises the alarm."""
        now = self.now_ms
        hand = self._arm.state.hand_mm
        inside = gas.is_inside(hand)
        cell = self._cell
        cell["inside"] = inside
        cell["inside_ms"] = cell["inside_ms"] + now - start_ms if inside else 0
        if inside and self._inspect is not None and math.dist(hand, self._inspect) <= self._tol:
            cell["inspected"] = True
        if inside and self._spike_after is not None and not cell["spiked"] and cell["inside_ms"] >= self._spike_after:
            self._gas.spike("h2s", gas.SPIKE_H2S_PPM)
            cell["spiked"] = True
        failed = self._monitor(now)
        if inside and failed:
            self._raise_alarm("gas:" + ",".join(failed))
        if inside and now - cell["monitor_t_ms"] > gas.GAS_STALE_MS:
            self._raise_alarm("gas_stale")

    def _monitor(self, now):
        """Takes the continuous meter reading at `now` unless the meter link is down. Returns the gases in alarm."""
        if self._meter_down():
            return []
        reading = self._gas.read()
        self._meter = {**reading, "t_ms": now}
        self._cell["monitor_t_ms"] = now
        return gas.failed_gases(reading)

    def _raise_alarm(self, reason):
        """Latches the alarm (the first reason stays) and aborts a live permit, as an entry supervisor would."""
        if self._cell["alarm_since_ms"] is None:
            self._cell.update(alarm_since_ms=self.now_ms, alarm_reason=reason)
        if self._cell["permit"] == "live":
            self._cell["permit"] = "aborted"

    def _meter_down(self):
        return self._dropout is not None and self._dropout[0] <= self._calls < self._dropout[1]

    # ---- views

    def _purge(self):
        return round(self._gas.purge_fraction, 4)

    def _panel(self):
        """The cell as the control room sees it: permit, alarm lamp, the last meter reading and gas test, and the purge."""
        cell = self._cell
        return {
            "permit": cell["permit"], "alarm": cell["alarm_since_ms"] is not None, "alarm_reason": cell["alarm_reason"],
            "inside": gas.is_inside(self._arm.state.hand_mm), "gas": copy.deepcopy(self._meter), "test": copy.deepcopy(self._test),
            "purge_fraction": self._purge(), "purge_target": gas.PURGE_TARGET, "mouth_x_mm": gas.MOUTH_X_MM,
        }

    def _shift(self, sample):
        """`sample` (an arm reading) with every time stamp moved by the cell's extra time."""
        out = copy.deepcopy(sample)
        for reading in out["sensors"].values():
            reading["t_ms"] += self._idle_ms
        out["hand_t_ms"] += self._idle_ms
        return out

    def _as_confined(self, arm_state):
        fields_ = {**arm_state.to_dict(), **self._cell, "purge_fraction": self._purge()}
        fields_["t_ms"] += self._idle_ms
        return ConfinedState(**fields_)
