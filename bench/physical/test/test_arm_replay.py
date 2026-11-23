# SPDX-License-Identifier: Apache-2.0
import os
import unittest
import zlib

import _paths  # noqa: F401

# The headless GL backend (EGL) unless the host chose one: the render test then runs on a host with no display.
os.environ.setdefault("MUJOCO_GL", "egl")
from sim.arm_replay import flat_poses, key_moments, png_bytes

try:
    import mujoco  # noqa: F401
    from sim.arm_replay import RenderUnavailable, render_frame
except ImportError:  # no MuJoCo in this Python
    render_frame = None


def world_line(cause, times):
    return {"cause": cause, "poses": {"t_ms": times, "qpos": [[t] for t in times]}} if times else {"cause": cause}


EVENTS = [
    {"type": "call", "seq": 0, "unsafe": []},
    {"type": "executed", "call_id": "c0"},
    {"type": "call", "seq": 2, "unsafe": ["R3"]},
    {"type": "denied", "call_id": "c2"},
    {"type": "call", "seq": 4, "unsafe": []},
    {"type": "harm", "cause": "c4", "rules": ["R4"]},
]
WORLD = [world_line("tick", [0]), world_line("c0", [33, 66]), world_line("c2", [100]), world_line("c4", [133, 166]), world_line("settle", [])]


class KeyMomentTest(unittest.TestCase):
    def test_flat_poses_are_every_logged_pose_in_order(self):
        self.assertEqual([t for t, _ in flat_poses(WORLD)], [0, 33, 66, 100, 133, 166])

    def test_key_moments_are_the_unsafe_try_the_deny_the_harm_and_the_end(self):
        moments = key_moments(EVENTS, WORLD)
        self.assertEqual([(m["cause"], m["why"], m["pose_index"]) for m in moments], [
            ("c2", "unsafe try R3", 3), ("c2", "denied", 3), ("c4", "harm", 5), ("c4", "end of run", 5)])

    def test_a_run_with_no_poses_has_no_moments(self):
        self.assertEqual(key_moments(EVENTS, [world_line("tick", [])]), [])

    def test_a_png_has_its_signature_and_a_decodable_pixel_block(self):
        data = png_bytes(bytes([255, 0, 0] * 4), 2, 2)
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        idat = data[data.index(b"IDAT") + 4:data.index(b"IEND") - 8]
        self.assertEqual(len(zlib.decompress(idat)), 2 * (1 + 6))


@unittest.skipIf(render_frame is None, "MuJoCo is not installed in this Python")
class RenderTest(unittest.TestCase):
    def test_a_frame_is_a_png_or_the_host_says_it_cannot_draw(self):
        from sim.arm import Arm
        import random
        arm = Arm({"rated_max_mmps": 250}, random.Random(1))
        try:
            frame = render_frame(arm._body.pose(), arm.state.block_mm[:2], size_px=32)
        except RenderUnavailable:
            self.skipTest("no GL backend on this host (MUJOCO_GL=egl needs libEGL, osmesa needs libOSMesa)")
        self.assertEqual(frame[:4], b"\x89PNG")


if __name__ == "__main__":
    unittest.main()
