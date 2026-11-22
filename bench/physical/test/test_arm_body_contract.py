# SPDX-License-Identifier: Apache-2.0
"""The contract an arm body keeps for `Arm` (sim/arm.py), the gateway and the scorer.

`Arm` reaches its physics only through these `ArmBody` methods: `sandbox`, `set_intruder`, `place_hand`, `tick`,
`tip_mm`, `block_mm`, `block_is_moving`, `block_in_tray`, `arm_pushes_on_scene` and `pose`. Another body (for example
robot models from Strands Robots behind the same gateway, docs/physical-ai.md, More arm models) must pass this file
unchanged before it may back a release. Add it to BODIES. Each case states one behaviour the rules and the replay
depend on; none reads a body's inner state.
"""
import unittest

import _paths  # noqa: F401
from sim import arm_scene as scene

try:
    from sim.arm_body import ArmBody, ticks_in
except ImportError:  # no MuJoCo in this Python
    ArmBody = None

# Every body class that may back the arm plant.
BODIES = [ArmBody] if ArmBody else []
NEAR_MM = 5
SETTLE_MS = 1000
ABOVE_BLOCK_Z_MM = 80
PILLAR_TOP_MM = (scene.PILLAR_XY_MM[0], scene.PILLAR_XY_MM[1], scene.PILLAR_HEIGHT_MM - 40)


def near(a, b, mm=NEAR_MM):
    return all(abs(x - y) <= mm for x, y in zip(a, b))


def run_to(body, target_mm, ms=SETTLE_MS):
    for _ in range(ticks_in(ms)):
        body.tick(target_mm, scene.GRIPPER_OPEN_MM, False)


def fresh(cls):
    body = cls(list(scene.BLOCK_START_MM))
    body.place_hand(list(scene.HOME_MM), scene.GRIPPER_OPEN_MM)
    return body


@unittest.skipUnless(BODIES, "MuJoCo is not installed in this Python")
class ArmBodyContract(unittest.TestCase):
    def each(self):
        for cls in BODIES:
            with self.subTest(body=cls.__name__):
                yield cls

    def test_place_hand_puts_the_tip_where_asked(self):
        for cls in self.each():
            self.assertTrue(near(fresh(cls).tip_mm(), scene.HOME_MM))

    def test_tick_drives_the_tip_to_the_command(self):
        for cls in self.each():
            body = fresh(cls)
            target = [scene.BLOCK_START_MM[0], scene.BLOCK_START_MM[1], ABOVE_BLOCK_Z_MM]
            run_to(body, target)
            self.assertTrue(near(body.tip_mm(), target), body.tip_mm())

    def test_sandbox_undoes_every_change(self):
        for cls in self.each():
            body = fresh(cls)
            before = body.pose()
            with body.sandbox():
                run_to(body, [scene.BLOCK_START_MM[0], scene.BLOCK_START_MM[1], ABOVE_BLOCK_Z_MM])
                self.assertNotEqual(body.pose(), before)
            self.assertEqual(body.pose(), before)

    def test_same_inputs_give_the_same_poses(self):
        # The one-machine repeat check of D-30: a release's seeds must replay to the same poses.
        for cls in self.each():
            runs = []
            for _ in range(2):
                body = fresh(cls)
                run_to(body, [scene.BLOCK_START_MM[0], scene.BLOCK_START_MM[1], ABOVE_BLOCK_Z_MM])
                runs.append(body.pose())
            self.assertEqual(runs[0], runs[1])

    def test_the_block_starts_at_rest_on_the_table_outside_the_tray(self):
        for cls in self.each():
            body = fresh(cls)
            run_to(body, list(scene.HOME_MM), ms=200)
            self.assertTrue(near(body.block_mm()[:2], scene.BLOCK_START_MM))
            self.assertFalse(body.block_is_moving())
            self.assertFalse(body.block_in_tray())

    def test_pushing_into_the_pillar_is_a_contact_and_free_air_is_not(self):
        for cls in self.each():
            body = fresh(cls)
            run_to(body, list(scene.HOME_MM), ms=200)
            self.assertFalse(body.arm_pushes_on_scene())
            pushed = False
            for _ in range(ticks_in(SETTLE_MS)):
                body.tick(PILLAR_TOP_MM, scene.GRIPPER_OPEN_MM, False)
                pushed = pushed or body.arm_pushes_on_scene()
            self.assertTrue(pushed)

    def test_pose_is_a_flat_list_of_rounded_floats(self):
        for cls in self.each():
            pose = fresh(cls).pose()
            self.assertTrue(pose and all(isinstance(v, float) for v in pose))

    def test_a_parked_intruder_is_not_a_contact(self):
        for cls in self.each():
            body = fresh(cls)
            body.set_intruder(None)
            run_to(body, list(scene.HOME_MM), ms=200)
            self.assertFalse(body.arm_pushes_on_scene())


if __name__ == "__main__":
    unittest.main()
