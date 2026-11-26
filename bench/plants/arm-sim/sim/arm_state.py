# SPDX-License-Identifier: Apache-2.0
"""The arm's true state: what is really so, in whole numbers, and the time each tool costs. Never decides policy."""
from dataclasses import asdict, dataclass
from typing import List, Optional

from . import arm_scene as scene

DEFAULT_RATED_GRIP_N = 20


@dataclass
class ArmState:
    """The cell as it really is. Positions are whole mm, speeds whole mm/s, forces whole N.

    `hand_mm` is the hand tip, `goal_mm` where the current move ends and `command_um` the point the controller
    asks the tip to be at (micrometres, so a move resumes exactly where it was). `speed_mmps` is the hand speed
    at the end of the step, `peak_mmps` the highest speed inside the step. `target_mmps` is the speed cap set
    by `set_speed`; `rated_max_mmps` and `rated_grip_n` are the ratings the rules compare against. `running`
    means a move is under way. `in_keepout` says the hand was inside the keep-out box during the step.
    `jammed` is a contact the arm cannot push through; `jam_since_ms` is when it began. `intruder_mm` is where an
    `obstacle` fault put a box on the table (x, y), or None.
    """

    t_ms: int
    hand_mm: List[int]
    goal_mm: List[int]
    command_um: List[int]
    speed_mmps: int
    peak_mmps: int
    target_mmps: int
    rated_max_mmps: int
    running: bool
    gripper_mm: int
    holding: bool
    grip_force_n: int
    rated_grip_n: int
    guard: str
    estop: bool
    jammed: bool
    jam_since_ms: Optional[int]
    person_in_zone: bool
    in_keepout: bool
    block_mm: List[int]
    block_in_tray: bool
    intruder_mm: Optional[List[int]] = None

    @property
    def moving(self):
        """The hand is travelling at the end of the step. Cedar reads this through the speed sensor."""
        return self.speed_mmps > 0

    @property
    def moved(self):
        """The hand travelled at some point inside the step. The rules about harm read this."""
        return self.peak_mmps > 0

    def to_dict(self):
        return asdict(self)


def state_from_start(start, hand_mm, block_mm):
    """The time-0 ArmState from a task `start` block, with the hand tip at `hand_mm` and the block at `block_mm`.

    `start` needs `rated_max_mmps`. Optional: `target_mmps` (the speed cap, default the rating), `rated_grip_n`,
    `guard`, `person_in_zone`, `jammed` (sets `jam_since_ms` to 0) and `goal_mm` (a move already under way, which
    runs from the first step). A `jammed: true` start is a contact the arm cannot move out of.
    """
    rated = start["rated_max_mmps"]
    goal = list(start.get("goal_mm", hand_mm))
    jammed = start.get("jammed", False)
    return ArmState(
        t_ms=0, hand_mm=list(hand_mm), goal_mm=goal, command_um=[v * 1000 for v in hand_mm], speed_mmps=0, peak_mmps=0,
        target_mmps=start.get("target_mmps", rated), rated_max_mmps=rated, running=goal != list(hand_mm),
        gripper_mm=scene.GRIPPER_OPEN_MM, holding=False, grip_force_n=0, rated_grip_n=start.get("rated_grip_n", DEFAULT_RATED_GRIP_N),
        guard=start.get("guard", "closed"), estop=False, jammed=jammed, jam_since_ms=0 if jammed else None,
        person_in_zone=start.get("person_in_zone", False), in_keepout=False, block_mm=list(block_mm), block_in_tray=False,
    )
