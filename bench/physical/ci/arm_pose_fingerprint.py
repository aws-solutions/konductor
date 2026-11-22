# SPDX-License-Identifier: Apache-2.0
"""The arm's pose fingerprint, for the two-host repeat check (DEBT D-30). Free: no gateway, no model, no release.

A release's seeds must replay to the same poses on any host with the pinned wheels. This runs a fixed set of call
scripts on the arm simulator, each from a fixed seed, and records every pose the run logs, the final state and the
host (Python, wheels, CPU). Run it on two hosts and compare:

    python arm_pose_fingerprint.py --out host-a.json          # on host A, in the arm venv
    python arm_pose_fingerprint.py --out host-b.json          # on host B, same commit, same pinned wheels
    python arm_pose_fingerprint.py --compare host-a.json host-b.json

`--compare` exits 0 when every case has the same poses, 1 otherwise, naming each case that differs, its first
differing pose and the largest joint difference. It also lists host fields that differ (a wheel version first).
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sim.arm import Arm  # noqa: E402
from sim.faults import read_faults  # noqa: E402

FORMAT = 1
WHEELS = ("mujoco", "numpy", "cedarpy")
START = {"rated_max_mmps": 250}
# Each case: a name, a seed and the calls, in order. They reach the paths the rules read: free moves, a slow capped
# move, a grip, a carry, a push into the pillar, a stop, then the settle.
CASES = (
    ("free-moves", 1, [("move_to", {"x_mm": 200, "y_mm": 50, "z_mm": 100}), ("move_to", {"x_mm": 150, "y_mm": -60, "z_mm": 180})]),
    ("slow-cap-then-stop", 2, [("set_speed", {"speed_mmps": 50}), ("move_to", {"x_mm": 200, "y_mm": 90, "z_mm": 60}), ("stop", {})]),
    ("grip-and-carry", 3, [("move_to", {"x_mm": 220, "y_mm": 80, "z_mm": 60}), ("move_to", {"x_mm": 220, "y_mm": 80, "z_mm": 15}),
                           ("set_gripper", {"width_mm": 30, "force_n": 20}), ("move_to", {"x_mm": 220, "y_mm": 80, "z_mm": 150}),
                           ("move_to", {"x_mm": 220, "y_mm": -120, "z_mm": 150})]),
    ("push-into-pillar", 4, [("move_to", {"x_mm": 220, "y_mm": -20, "z_mm": 80})]),
)


def run_case(seed, calls):
    """The poses (`[[t_ms, qpos], ...]`) and final state of `calls` on a fresh arm seeded `seed`, settle included."""
    arm = Arm(START, random.Random(seed), read_faults(()))
    poses = []

    def drain():
        got = arm.drain_poses()
        if got:
            poses.extend([t, q] for t, q in zip(got["t_ms"], got["qpos"]))

    drain()
    for tool, args in calls:
        arm.begin_call()
        arm.execute(tool, args)
        drain()
    for _ in arm.settle():
        drain()
    state = arm.state
    return {"poses": poses, "final": {"hand_mm": state.hand_mm, "t_ms": state.t_ms, "running": state.running}}


def host_info():
    """The fields of this host that can change the physics: Python, the arm wheels, the CPU and the OS."""
    wheels = {}
    for name in WHEELS:
        try:
            wheels[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            wheels[name] = None
    cpu = None
    try:
        with open("/proc/cpuinfo") as f:
            cpu = next((line.split(":", 1)[1].strip() for line in f if line.startswith("model name")), None)
    except OSError:
        pass
    return {"python": platform.python_version(), "wheels": wheels, "machine": platform.machine(), "cpu": cpu, "system": platform.platform()}


def fingerprint():
    """The whole fingerprint: format, host and, per case, its poses, final state and their SHA-256."""
    cases = {}
    for name, seed, calls in CASES:
        run = run_case(seed, calls)
        run["sha256"] = hashlib.sha256(json.dumps(run, sort_keys=True).encode()).hexdigest()
        cases[name] = run
    return {"format": FORMAT, "host": host_info(), "cases": cases}


def case_difference(a, b):
    """Why two runs of one case differ (first differing pose and the largest joint difference), or None."""
    if a["sha256"] == b["sha256"]:
        return None
    if len(a["poses"]) != len(b["poses"]):
        return f"{len(a['poses'])} poses against {len(b['poses'])}"
    for i, (pa, pb) in enumerate(zip(a["poses"], b["poses"])):
        if pa != pb:
            biggest = max(abs(x - y) for x, y in zip(pa[1], pb[1])) if pa[0] == pb[0] else None
            at = f"pose {i} (t {pa[0]} ms)"
            return f"first differs at {at}" + (f", largest joint difference {biggest:.5f}" if biggest is not None else ", at another time")
    return f"final state {a['final']} against {b['final']}"


def compare(a, b):
    """`(same, lines)`: whether every case of fingerprints `a` and `b` has the same poses, and the report lines."""
    lines = []
    for key in sorted(set(a["host"]) | set(b["host"])):
        if a["host"].get(key) != b["host"].get(key):
            lines.append(f"host {key}: {a['host'].get(key)} against {b['host'].get(key)}")
    same = True
    for name in sorted(set(a["cases"]) | set(b["cases"])):
        if name not in a["cases"] or name not in b["cases"]:
            same = False
            lines.append(f"case {name}: only in one file")
            continue
        why = case_difference(a["cases"][name], b["cases"][name])
        if why:
            same = False
            lines.append(f"case {name}: DIFFERS, {why}")
        else:
            lines.append(f"case {name}: same ({len(a['cases'][name]['poses'])} poses)")
    return same, lines


def main(argv=None):
    p = argparse.ArgumentParser(description="arm pose fingerprint for the two-host repeat check (D-30)")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--out", help="write this host's fingerprint to OUT")
    g.add_argument("--compare", nargs=2, metavar=("A", "B"), help="compare two fingerprint files")
    args = p.parse_args(argv)
    if args.out:
        fp = fingerprint()
        with open(args.out, "w") as f:
            json.dump(fp, f)
        print(f"wrote {args.out}: {len(fp['cases'])} cases, wheels {fp['host']['wheels']}")
        return 0
    with open(args.compare[0]) as fa, open(args.compare[1]) as fb:
        a, b = json.load(fa), json.load(fb)
    same, lines = compare(a, b)
    print("\n".join(lines))
    print("SAME POSES on every case" if same else "POSES DIFFER")
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main())
