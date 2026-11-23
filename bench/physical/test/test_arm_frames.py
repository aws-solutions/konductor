# SPDX-License-Identifier: Apache-2.0
"""Still frames of an arm trial's key moments, for plant-trace (DEBT D-29)."""
import base64
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

import _paths  # noqa: F401
from sim.arm_frames import frames, main
from sim.arm_replay import RenderUnavailable

EVENTS = [
    {"type": "call", "seq": 0, "unsafe": []},
    {"type": "executed", "call_id": "c0"},
    {"type": "call", "seq": 2, "unsafe": ["R3"]},
    {"type": "denied", "call_id": "c2"},
]
WORLD = [
    {"cause": "tick", "state": {"block_mm": [120, -40, 15]}, "poses": {"t_ms": [0], "qpos": [[0.0]]}},
    {"cause": "c0", "poses": {"t_ms": [33, 66], "qpos": [[0.1], [0.2]]}},
    {"cause": "c2", "poses": {"t_ms": [100], "qpos": [[0.3]]}},
]


def fake_render(qpos, block_xy_mm, size_px):
    return json.dumps({"qpos": qpos, "block": block_xy_mm, "size": size_px}).encode()


class FramesTest(unittest.TestCase):
    def test_one_frame_per_key_pose_with_every_reason_drawn_from_the_logged_pose(self):
        out = frames(EVENTS, WORLD, render=fake_render, size_px=8)
        self.assertEqual([(f["cause"], f["why"], f["t_ms"]) for f in out], [("c2", "unsafe try R3, denied, end of run", 100)])
        drawn = json.loads(out[0]["png"])
        self.assertEqual(drawn, {"qpos": [0.3], "block": [120, -40], "size": 8})

    def test_a_reason_repeated_at_one_pose_is_counted_not_repeated(self):
        events = EVENTS + [{"type": "harm", "cause": "c2", "rules": ["R4"]}, {"type": "harm", "cause": "c2", "rules": ["R4"]}]
        self.assertEqual(frames(events, WORLD, render=fake_render)[0]["why"], "unsafe try R3, denied, harm x2, end of run")

    def test_no_pose_means_no_frame(self):
        self.assertEqual(frames(EVENTS, [{"cause": "tick", "state": {"block_mm": [0, 0, 0]}}], render=fake_render), [])

    def test_main_prints_base64_frames_or_says_why_it_cannot_draw(self):
        with tempfile.TemporaryDirectory() as d:
            g, w = os.path.join(d, "gateway.jsonl"), os.path.join(d, "world.jsonl")
            for path, lines in ((g, EVENTS), (w, WORLD)):
                with open(path, "w", encoding="utf-8") as f:
                    f.write("".join(json.dumps(x) + "\n" for x in lines))
            buf = io.StringIO()
            with redirect_stdout(buf):
                main([g, w], render=fake_render)
            got = json.loads(buf.getvalue())
            self.assertEqual(len(got["frames"]), 1)
            self.assertIn(b'"qpos": [0.3]', base64.b64decode(got["frames"][0]["png_base64"]))

            def no_gl(*_):
                raise RenderUnavailable("no GL")
            buf = io.StringIO()
            with redirect_stdout(buf):
                main([g, w], render=no_gl)
            self.assertEqual(json.loads(buf.getvalue()), {"frames": [], "unavailable": "no GL"})


if __name__ == "__main__":
    unittest.main()
