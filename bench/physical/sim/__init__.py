# SPDX-License-Identifier: Apache-2.0
"""The plant simulators, imported as `sim.<module>`.

This folder holds only the modules every plant shares (`faults`, `meta`). Each plant's own modules live in
`bench/plants/<kind>/sim/` (B-003 step 3b) and join this package's search path here, so `from sim.conveyor import ...`
and the modules' relative imports work unchanged, and a new plant's simulator needs no edit in this folder.
The runner names the plant folders in BENCH_PLANT_DIRS (runner/lib/plant/gateway-proc.js); with none named, every
folder of bench/plants is a plant folder. plant_gateway/kinds.py reads the same list (PLANT_FOLDERS).
"""
import os

PLANTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "plants")


def plant_folders(env, plants_dir):
    """The plant folders: the `os.pathsep` list in env["BENCH_PLANT_DIRS"], in its order, or, when that is unset or
    empty, every folder of `plants_dir` in name order.

    Raises ValueError when a named folder is not an absolute path or has no plugin.json.
    """
    named = env.get("BENCH_PLANT_DIRS", "")
    if not named:
        return [os.path.join(plants_dir, n) for n in sorted(os.listdir(plants_dir)) if os.path.isdir(os.path.join(plants_dir, n))]
    out = named.split(os.pathsep)
    for d in out:
        if not os.path.isabs(d):
            raise ValueError(f"BENCH_PLANT_DIRS entry {d!r} is not an absolute path")
        if not os.path.isfile(os.path.join(d, "plugin.json")):
            raise ValueError(f"BENCH_PLANT_DIRS entry {d!r} has no plugin.json")
    return out


def plant_sim_dirs(folders, shared_dir):
    """The `sim` folder of each plant folder in `folders` that has one, in that order.

    Raises ValueError when a module name (a `.py` file) is in two of those folders, or in one and in `shared_dir`,
    since only the first would ever be imported.
    """
    def modules(d):
        return {f[:-3] for f in os.listdir(d) if f.endswith(".py")}

    seen = {m: shared_dir for m in modules(shared_dir)}
    dirs = []
    for folder in folders:
        d = os.path.join(folder, "sim")
        if not os.path.isdir(d):
            continue
        for m in sorted(modules(d)):
            if m in seen:
                raise ValueError(f"sim module {m!r} is in two folders: {seen[m]} and {d}")
            seen[m] = d
        dirs.append(d)
    return dirs


PLANT_FOLDERS = plant_folders(os.environ, PLANTS_DIR)
__path__.extend(plant_sim_dirs(PLANT_FOLDERS, os.path.dirname(os.path.abspath(__file__))))
