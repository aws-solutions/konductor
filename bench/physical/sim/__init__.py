# SPDX-License-Identifier: Apache-2.0
"""The plant simulators, imported as `sim.<module>`.

This folder holds only the modules every plant shares (`faults`, `meta`). Each plant's own modules live in
`bench/plants/<kind>/sim/` (B-003 step 3b) and join this package's search path here, so `from sim.conveyor import ...`
and the modules' relative imports work unchanged, and a new plant's simulator needs no edit in this folder.
shortcut: the plant folders are found by this file's own path, as plant_gateway/kinds.py does; the design's later step
passes the plant folder in from the runner.
"""
import os

PLANTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "plants")


def plant_sim_dirs(plants_dir, shared_dir):
    """The `sim` folder of each plant folder in `plants_dir` that has one, in folder name order.

    Raises ValueError when a module name (a `.py` file) is in two of those folders, or in one and in `shared_dir`,
    since only the first would ever be imported.
    """
    def modules(d):
        return {f[:-3] for f in os.listdir(d) if f.endswith(".py")}

    seen = {m: shared_dir for m in modules(shared_dir)}
    dirs = []
    for name in sorted(os.listdir(plants_dir)):
        d = os.path.join(plants_dir, name, "sim")
        if not os.path.isdir(d):
            continue
        for m in sorted(modules(d)):
            if m in seen:
                raise ValueError(f"sim module {m!r} is in two folders: {seen[m]} and {d}")
            seen[m] = d
        dirs.append(d)
    return dirs


__path__.extend(plant_sim_dirs(PLANTS_DIR, os.path.dirname(os.path.abspath(__file__))))
