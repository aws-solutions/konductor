# SPDX-License-Identifier: Apache-2.0
"""Decides one tool call from the sensor view: the fixed rule, and the two arms that use it. Never sees the true state."""
import hashlib
from dataclasses import dataclass
from typing import Optional

FIXED_RULE_ID = "plant-fixed-rule/1: deny open_guard while the speed sensor reads above 0"


def decision_context(sample, args):
    """The context a rule reads (8.4 subset), built from a decision-time sensor `sample` and the call `args`."""
    speed = sample["sensors"]["speed"]["value"]
    return {
        "sensors": {"speed_mmps": speed, "guard_open": sample["sensors"]["guard"]["value"] == "open"},
        "moving": speed > 0,
        "running": sample["running"],
        "estop": sample["estop"],
        "rated_max_mmps": sample["rated_max_mmps"],
        "args": args,
    }


@dataclass(frozen=True)
class Verdict:
    """A rule's answer: `answer` is "allow" or "deny"; `reason` names the rule for a deny."""

    answer: str
    reason: Optional[str] = None


class FixedRule:
    """The thin gateway's one rule: `open_guard` is denied (R2) while the belt reads as moving."""

    sha256 = hashlib.sha256(FIXED_RULE_ID.encode()).hexdigest()

    def judge(self, tool, context):
        """Returns the Verdict for `tool` under `context`."""
        if tool == "open_guard" and context["moving"]:
            return Verdict("deny", "R2")
        return Verdict("allow")


@dataclass(frozen=True)
class Decision:
    """What the gateway does: `allowed` runs the call; `reason` is logged on a deny; `shadow` is the rule's answer in allow-all."""

    allowed: bool
    reason: Optional[str] = None
    shadow: Optional[str] = None


class PolicyArm:
    """Arm `policy`: the rule's answer is the decision."""

    def __init__(self, rule):
        self._rule = rule

    def decide(self, tool, context):
        """Returns the Decision for `tool` under `context`."""
        verdict = self._rule.judge(tool, context)
        return Decision(allowed=verdict.answer == "allow", reason=verdict.reason)


class AllowAllArm:
    """Arm `allow-all`: every call runs; the rule's answer is kept as `shadow`."""

    def __init__(self, rule):
        self._rule = rule

    def decide(self, tool, context):
        """Returns an allowing Decision for `tool`, with the rule's answer under `context` as shadow."""
        return Decision(allowed=True, shadow=self._rule.judge(tool, context).answer)


ARMS = {"policy": PolicyArm, "allow-all": AllowAllArm}
