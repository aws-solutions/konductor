# SPDX-License-Identifier: Apache-2.0
"""Still frames of an arm trial's key moments, for the plant-trace page (DEBT D-29).

`python -m sim.arm_frames GATEWAY_JSONL WORLD_JSONL` prints `{"frames": [{cause, why, t_ms, png_base64}]}`, or the same
with no frames and `"unavailable": reason` when no GL backend can draw (set MUJOCO_GL=egl or osmesa on a host with no
display). Reads the two logs only; the physics is never run again (see arm_replay).
"""
import base64
import json
import sys

from .arm_replay import FRAME_PX, RenderUnavailable, flat_poses, key_moments


def _render(qpos, block_xy_mm, size_px):
    from .arm_replay import render_frame  # imported here so the tests and a host without MuJoCo can load this module

    return render_frame(qpos, block_xy_mm, size_px=size_px)


def frames(events, world, render=_render, size_px=FRAME_PX):
    """One `{cause, why, t_ms, png}` per distinct key pose, in run order; moments at the same pose share one frame,
    their reasons joined (a repeated reason once, with its count). The block is drawn where the run's first world line put it."""
    poses = flat_poses(world)
    start = next((line["state"] for line in world if line.get("state")), {})
    block_xy = list(start.get("block_mm", [0, 0]))[:2]
    by_pose = {}
    for m in key_moments(events, world):
        if m["pose_index"] is None:
            continue
        by_pose.setdefault(m["pose_index"], {"cause": m["cause"], "why": []})["why"].append(m["why"])
    out = []
    for index, moment in by_pose.items():
        t_ms, qpos = poses[index]
        out.append({"cause": moment["cause"], "why": _reasons(moment["why"]), "t_ms": t_ms, "png": render(qpos, block_xy, size_px)})
    return out


def _reasons(whys):
    """"a, b x3, c": each reason once, in first-seen order, with its count when it repeats."""
    counts = {}
    for w in whys:
        counts[w] = counts.get(w, 0) + 1
    return ", ".join(w if n == 1 else f"{w} x{n}" for w, n in counts.items())


def _read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main(argv=None, render=_render):
    """Prints the frames of the trial whose logs are `argv` = [gateway.jsonl, world.jsonl] as JSON."""
    gateway, world = (argv if argv is not None else sys.argv[1:])[:2]
    try:
        drawn = frames(_read_jsonl(gateway), _read_jsonl(world), render=render)
    except RenderUnavailable as e:
        print(json.dumps({"frames": [], "unavailable": str(e)}))
        return
    print(json.dumps({"frames": [{**{k: f[k] for k in ("cause", "why", "t_ms")}, "png_base64": base64.b64encode(f["png"]).decode()} for f in drawn]}))


if __name__ == "__main__":
    main()
