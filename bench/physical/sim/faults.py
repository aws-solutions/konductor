# SPDX-License-Identifier: Apache-2.0
"""The six faults of 11.4, fired by call count or at the start, on the sensor view, the true state or the link. Never reads the clock or the policy."""
import copy
from dataclasses import dataclass, field
from typing import Optional

MIN_STALE_AGE_MS = 5000
SENSOR_KEYS = {"speed": "value", "jam": "value", "zone": "person", "guard": "value"}
STATE_FIELDS = {"running": bool, "speed_mmps": int, "target_mmps": int, "guard": str, "person_in_zone": bool, "jammed": bool}
GUARD_VALUES = ("open", "closed")
DROP_LINK = "drop_link"
ARM_ONLY_FAULTS = frozenset({"obstacle", "stale_hand"})


class FaultError(ValueError):
    """A task `faults` entry that cannot be used."""


def possible_reading(sensor, value):
    """True when `value` is a reading `sensor` can give: speed a whole number from 0, jam and zone a bool, guard open or closed."""
    if sensor == "speed":
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0
    if sensor == "guard":
        return value in GUARD_VALUES
    return isinstance(value, bool)


def true_reading(state, sensor):
    """What `sensor` would read on `state` with no noise and no fault."""
    return {"speed": state.speed_mmps, "jam": state.jammed, "zone": state.person_in_zone, "guard": state.guard}[sensor]


def apply_state_change(state, change):
    """Sets the true-state fields in `change` on `state`. A jam that starts here starts the jam clock at `state.t_ms`."""
    was_jammed = state.jammed
    for name, value in change.items():
        setattr(state, name, value)
    if state.jammed and not was_jammed:
        state.jam_since_ms = state.t_ms
    if not state.jammed:
        state.jam_since_ms = None


@dataclass
class Fault:
    """One `faults` entry. `which` names the fault; `at_call` is the call count it fires on (0: at the start;
    for drop_link, the Nth executed motion call); `spec` holds the rest of the entry."""

    which: str
    at_call: int
    spec: dict = field(default_factory=dict)


@dataclass
class SensorOverlay:
    """A fired sensor fault, active from call `from_call` until before call `until_call` (None: the rest of the run).

    With `sensor` set, that sensor reads `value`, stamped `t_ms` (None keeps the sample's own stamp). With `text`
    set, only `display_text` changes. With `panel` set (a dict), those panel fields replace the sample's.
    """

    from_call: int
    until_call: Optional[int] = None
    sensor: Optional[str] = None
    value: object = None
    t_ms: Optional[int] = None
    text: Optional[str] = None
    panel: Optional[dict] = None

    def active(self, call_n):
        return self.from_call <= call_n and (self.until_call is None or call_n < self.until_call)

    def apply(self, sample):
        """Changes `sample` in place."""
        if self.text is not None:
            sample["display_text"] = self.text
            return
        if self.panel is not None:
            sample.update(copy.deepcopy(self.panel))
            return
        reading = sample["sensors"][self.sensor]
        stamp = reading["t_ms"] if self.t_ms is None else self.t_ms
        sample["sensors"][self.sensor] = {SENSOR_KEYS[self.sensor]: self.value, "t_ms": stamp}


def _check_sensor(spec):
    if spec.get("sensor") not in SENSOR_KEYS:
        raise FaultError(f"sensor must be one of {sorted(SENSOR_KEYS)}")


def _check_state(change, what):
    if not isinstance(change, dict) or not change:
        raise FaultError(f"{what} must be a non-empty object")
    for name, value in change.items():
        kind = STATE_FIELDS.get(name)
        if kind is None or not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
            raise FaultError(f"{what}.{name} is not a true-state field of the right type")
    if "guard" in change and change["guard"] not in GUARD_VALUES:
        raise FaultError(f"{what}.guard must be open or closed")


def _check_stale(spec):
    _check_sensor(spec)
    if not isinstance(spec.get("calls"), int) or spec["calls"] < 1:
        raise FaultError("stale_sensor needs calls >= 1")
    if spec.get("ageMs", MIN_STALE_AGE_MS) < MIN_STALE_AGE_MS:
        raise FaultError(f"stale_sensor ageMs must be at least {MIN_STALE_AGE_MS}")


def _check_out_of_range(spec):
    _check_sensor(spec)
    if "value" not in spec or possible_reading(spec["sensor"], spec["value"]):
        raise FaultError("out_of_range needs a value the sensor cannot give")


def _check_text(spec):
    if not isinstance(spec.get("text"), str) or not spec["text"]:
        raise FaultError("inject_text needs a non-empty text")


def _check_state_change(spec):
    _check_state(spec.get("state"), "state_change.state")


def _check_obstacle(spec):
    at = spec.get("at_mm")
    if not (isinstance(at, list) and len(at) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in at)):
        raise FaultError("obstacle needs at_mm, the box position as two whole mm [x, y]")


def _check_stale_hand(spec):
    if not isinstance(spec.get("calls"), int) or spec["calls"] < 1:
        raise FaultError("stale_hand needs calls >= 1")
    if spec.get("ageMs", MIN_STALE_AGE_MS) < MIN_STALE_AGE_MS:
        raise FaultError(f"stale_hand ageMs must be at least {MIN_STALE_AGE_MS}")


def _check_drop(spec):
    if spec["atCall"] < 1:
        raise FaultError("drop_link fires on the Nth motion call; atCall must be at least 1")
    if not isinstance(spec.get("partialMs", 0), int) or spec.get("partialMs", 0) < 0:
        raise FaultError("drop_link partialMs must be a whole number from 0")
    if "then" in spec:
        _check_state(spec["then"], "drop_link.then")


CHECKS = {
    "stale_sensor": _check_stale, "obstacle": _check_obstacle, "stale_hand": _check_stale_hand, "out_of_range": _check_out_of_range, "inject_text": _check_text,
    "state_change": _check_state_change, DROP_LINK: _check_drop, "jam": lambda spec: None,
}


def read_faults(entries):
    """The Fault list for a task's `faults` entries (11.4, 9.4). Raises FaultError on an unknown fault or bad fields."""
    faults = []
    for entry in entries:
        which, at_call = entry.get("which"), entry.get("atCall")
        if which not in CHECKS:
            raise FaultError(f"unknown fault {which!r}")
        if not isinstance(at_call, int) or isinstance(at_call, bool) or at_call < 0:
            raise FaultError(f"{which}: atCall must be a whole number from 0")
        CHECKS[which](entry)
        faults.append(Fault(which, at_call, {k: v for k, v in entry.items() if k not in ("which", "atCall")}))
    return faults


class FaultPlan:
    """The faults of one run. `faults` is the list from `read_faults`. Calls are counted from 1; the start is call 0."""

    def __init__(self, faults):
        self._waiting = [f for f in faults if f.which != DROP_LINK]
        self._drops = {f.at_call: f for f in faults if f.which == DROP_LINK}
        self._overlays = []
        self._motion_calls = 0

    def fire(self, call_n, state):
        """Fires every fault due at call `call_n` on the true `state` (changed in place). Returns the fired faults."""
        due = [f for f in self._waiting if f.at_call == call_n]
        self._waiting = [f for f in self._waiting if f.at_call != call_n]
        for fault in due:
            self._fire_one(fault, call_n, state)
        return due

    def overlay(self, sample, call_n):
        """A copy of `sample` (a sensor reading) with every sensor fault active at call `call_n` applied."""
        out = copy.deepcopy(sample)
        for o in self._overlays:
            if o.active(call_n):
                o.apply(out)
        return out

    def drop_on_motion(self):
        """Counts one executed motion call. Returns the drop_link fault due on it, or None."""
        self._motion_calls += 1
        return self._drops.get(self._motion_calls)

    def _fire_one(self, fault, call_n, state):
        spec = fault.spec
        if fault.which == "jam":
            apply_state_change(state, {"jammed": True})
        elif fault.which == "state_change":
            apply_state_change(state, spec["state"])
        elif fault.which == "obstacle":
            state.intruder_mm = list(spec["at_mm"])
        elif fault.which == "stale_hand":
            # The window counts real calls, like stale_sensor. The hand reads where it was when the fault fired, stamped ageMs earlier.
            until = max(call_n, 1) + spec["calls"]
            panel = {"hand_mm": list(spec.get("value", state.hand_mm)), "hand_t_ms": state.t_ms - spec.get("ageMs", MIN_STALE_AGE_MS)}
            self._overlays.append(SensorOverlay(call_n, until, panel=panel))
        elif fault.which == "inject_text":
            self._overlays.append(SensorOverlay(call_n, text=spec["text"]))
        elif fault.which == "out_of_range":
            self._overlays.append(SensorOverlay(call_n, sensor=spec["sensor"], value=spec["value"]))
        else:
            # The window counts real calls, so a fault present at the start still covers the first `calls` calls.
            value = spec.get("value", true_reading(state, spec["sensor"]))
            stamp = state.t_ms - spec.get("ageMs", MIN_STALE_AGE_MS)
            until = max(call_n, 1) + spec["calls"]
            self._overlays.append(SensorOverlay(call_n, until, spec["sensor"], value, stamp))
