# SPDX-License-Identifier: Apache-2.0
"""Decides one tool call from the sensor view: the Cedar double ask (12.3), the fixed rule, and the two arms. Never sees the true state."""
import hashlib
from dataclasses import dataclass
from typing import Optional

from sim.faults import SENSOR_KEYS, possible_reading

ALLOW, APPROVAL_REQUIRED, DENY = "allow", "approval_required", "deny"
FIXED_RULE_ID = "plant-fixed-rule/1: deny open_guard while the speed sensor reads above 0"


class PolicyInvalid(Exception):
    """The policy, its schema or its sensor limits cannot be used."""


class SensorLimits:
    """Freshness limits from the release's `sensor-limits.json`.

    `limits` maps a sensor name (speed, jam, zone, guard) to `maxAgeMs` and, for speed, `min` and `max`.
    A sensor with no entry has no age or range limit. A reading the sensor cannot give (a zone of 7, a speed
    of -3000) is never fresh, so the policy fails closed on it (11.4).
    """

    def __init__(self, limits):
        self._limits = limits

    def entry(self, name):
        """The limits file's entry `name` (a sensor's limits, or another section such as `keepout`), or {} when absent."""
        return self._limits.get(name, {})

    def fresh(self, sensors, now_ms):
        """True when every reading in `sensors` is fresh at `now_ms` (see `fresh_each`)."""
        return all(self.fresh_each(sensors, now_ms).values())

    def fresh_each(self, sensors, now_ms):
        """Per sensor name: whether its reading is possible, within its age limit at `now_ms` and within its range."""
        return {name: self._within(name, reading, now_ms) for name, reading in sensors.items()}

    def _within(self, name, reading, now_ms):
        # A sensor of another plant (not one of the conveyor's four) keeps its reading under "value".
        value = reading[SENSOR_KEYS.get(name, "value")]
        if not possible_reading(name, value):
            return False
        limit = self._limits.get(name, {})
        if now_ms - reading["t_ms"] > limit.get("maxAgeMs", float("inf")):
            return False
        if name != "speed":
            return True
        return limit.get("min", value) <= value <= limit.get("max", value)


def decision_context(sample, args, now_ms, limits, approved):
    """The Cedar context (8.4) from a decision-time sensor `sample`, the call `args`, sim time `now_ms`,
    SensorLimits `limits` and the gateway-set `approved` flag. A non-bool zone reading counts as a person present."""
    sensors = sample["sensors"]
    speed = sensors["speed"]["value"]
    person = sensors["zone"]["person"]
    return {
        "sensors": {
            "speed_mmps": speed, "speed_age_ms": now_ms - sensors["speed"]["t_ms"],
            "guard_open": sensors["guard"]["value"] == "open", "person_in_zone": person is not False,
            "zone_age_ms": now_ms - sensors["zone"]["t_ms"], "jam": sensors["jam"]["value"] is True,
            "fresh": limits.fresh(sensors, now_ms),
        },
        "moving": speed > 0, "running": sample["running"], "estop": sample["estop"],
        "rated_max_mmps": sample["rated_max_mmps"], "args": args, "approved": approved,
    }


class FixedRule:
    """The thin rule used when no Cedar policy is loaded: `open_guard` is denied while the belt reads as moving."""

    sha256 = hashlib.sha256(FIXED_RULE_ID.encode()).hexdigest()

    def permits(self, tool, context):
        """True unless `tool` is open_guard and `context` reads moving."""
        return not (tool == "open_guard" and context["moving"])


class CedarPolicy:
    """A Cedar policy checked against its schema at load.

    `policy_text` and `schema_text` are the release's `plant.cedar` and `plant.cedarschema`. `cedar` is the
    cedarpy module. Raises PolicyInvalid when validation fails.
    """

    def __init__(self, policy_text, schema_text, cedar):
        result = cedar.validate_policies(policy_text, schema_text)
        if not result.validation_passed:
            raise PolicyInvalid("; ".join(str(e) for e in result.errors) or "policy failed validation")
        self._policy = policy_text
        self._schema = schema_text
        self._cedar = cedar
        self.sha256 = hashlib.sha256(policy_text.encode("utf-8")).hexdigest()

    def permits(self, tool, context):
        """True when Cedar allows `tool` for the run's agent on line1 under `context`. Any evaluation error denies."""
        request = {
            "principal": 'Plant::Agent::"run"', "action": f'Plant::Action::"{tool}"', "resource": 'Plant::Line::"line1"',
            "context": context,
        }
        try:
            return self._cedar.is_authorized(request, self._policy, [], schema=self._schema).allowed
        except Exception:  # fail closed: whatever the evaluator raises, the call is denied and the gateway stays up
            return False


def double_ask(rule, tool, context_for):
    """The policy's answer for `tool` (12.3). `context_for(approved)` builds the context for each ask.

    Allow on the first ask is ALLOW; deny then allow is APPROVAL_REQUIRED; deny on both is DENY.
    """
    if rule.permits(tool, context_for(False)):
        return ALLOW
    return APPROVAL_REQUIRED if rule.permits(tool, context_for(True)) else DENY


@dataclass(frozen=True)
class Decision:
    """What the gateway does with one call.

    `disposition` is "allowed", "denied" or "approval_required"; `uses_approval` consumes the live record;
    `shadow` is the policy's answer in allow-all.
    """

    disposition: str
    uses_approval: bool = False
    shadow: Optional[str] = None


class PolicyArm:
    """Arm `policy`: approval required plus a live approval runs the call and uses the approval."""

    def decide(self, answer, has_live_approval):
        """The Decision for policy `answer` when `has_live_approval` says whether a live record exists."""
        if answer == ALLOW:
            return Decision("allowed")
        if answer == APPROVAL_REQUIRED:
            return Decision("allowed", uses_approval=True) if has_live_approval else Decision("approval_required")
        return Decision("denied")


class AllowAllArm:
    """Arm `allow-all`: every call runs, the answer is kept as `shadow`, and a live approval is still used."""

    def decide(self, answer, has_live_approval):
        """An allowing Decision; it uses the live approval when `has_live_approval`."""
        return Decision("allowed", uses_approval=has_live_approval, shadow=answer)


ARMS = {"policy": PolicyArm, "allow-all": AllowAllArm}
