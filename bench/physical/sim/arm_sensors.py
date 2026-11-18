# SPDX-License-Identifier: Apache-2.0
"""The arm's sensor view: the four faultable sensors (speed, jam, zone, guard), the panel and the fixed scene facts."""
from . import arm_scene as scene

SPEED_NOISE_MMPS = 5
SCENE_FACTS = {
    "tray_mm": list(scene.TRAY_CENTER_MM), "tray_inner_mm": scene.TRAY_INNER_MM, "block_size_mm": scene.BLOCK_SIZE_MM,
    "pillar": {"x_mm": scene.PILLAR_XY_MM[0], "y_mm": scene.PILLAR_XY_MM[1], "radius_mm": scene.PILLAR_RADIUS_MM, "height_mm": scene.PILLAR_HEIGHT_MM},
    "keepout_min_mm": list(scene.KEEPOUT_MIN_MM), "keepout_max_mm": list(scene.KEEPOUT_MAX_MM), "home_mm": list(scene.HOME_MM),
}


class ArmSensorModel:
    """Turns a true state into a sensor reading. `rng` (a `random.Random`) is the only source of noise.

    Hand position, finger width, holding and the block position are encoder-like and read exactly. Faults act on the
    four `sensors` entries and on `display_text` only.
    """

    def __init__(self, rng):
        self._rng = rng

    def _speed(self, state):
        if not state.moving:
            return 0
        return max(0, state.speed_mmps + self._rng.randint(-SPEED_NOISE_MMPS, SPEED_NOISE_MMPS))

    def sample(self, state):
        """Returns one noisy reading of `state`, every sensor stamped with the state's sim time."""
        return self._reading(state, self._speed(state))

    def exact_sample(self, state):
        """Returns the reading of `state` with no noise (test mode)."""
        return self._reading(state, state.speed_mmps)

    def _reading(self, state, speed):
        t = state.t_ms
        return {
            "sensors": {
                "speed": {"value": speed, "t_ms": t},
                "jam": {"value": state.jammed, "t_ms": t},
                "zone": {"person": state.person_in_zone, "t_ms": t},
                "guard": {"value": state.guard, "t_ms": t},
            },
            "display_text": "",
            "rated_max_mmps": state.rated_max_mmps,
            "rated_grip_n": state.rated_grip_n,
            "running": state.running,
            "estop": state.estop,
            "hand_mm": list(state.hand_mm),
            "hand_t_ms": t,
            "gripper_mm": state.gripper_mm,
            "holding": state.holding,
            "block_mm": list(state.block_mm),
            "scene": SCENE_FACTS,
        }
