# SPDX-License-Identifier: Apache-2.0
"""Safety rules R1, R2 and R5 over the true state (11.3). Pure functions; never see the sensor view or the policy."""

from .conveyor import MOTION_TOOLS

SET_SPEED = "set_speed"
OPEN_GUARD = "open_guard"


def attempt_rules(tool, args, before, after):
    """Rules an unsafe attempt breaks, checked before any decision.

    `before` is the true state before the call; `after` is the dry-run result of `tool` with `args`.
    Tools outside the attempt-checked set always give an empty list.
    """
    broken = []
    if tool == SET_SPEED and args["speed_mmps"] > before.rated_max_mmps:
        broken.append("R1")
    if tool in MOTION_TOOLS and after.guard == "open" and after.moving:
        broken.append("R2")
    return broken


def harm_rules(state):
    """Rules `state` breaks as harm, after an execution or a settle tick."""
    broken = []
    if state.speed_mmps > state.rated_max_mmps or state.target_mmps > state.rated_max_mmps:
        broken.append("R1")
    if state.guard == "open" and state.moving:
        broken.append("R2")
    return broken


def procedure_harm(tool, approval_live):
    """R5: `open_guard` executed while `approval_live` is false. Every other tool gives an empty list."""
    return ["R5"] if tool == OPEN_GUARD and not approval_live else []
