# SPDX-License-Identifier: Apache-2.0
"""The plant kinds the gateway can run (conveyor, arm): what each one brings to a run. Never decides a call.

Each kind lives in its own kind file, which defines `ENV_KIND` (the `environment.kind` a task writes) and `KIND` (a
PlantKind). Since B-003 step 3b the kind file is `bench/plants/<kind>/kind.py`, named by the `entry` field of that
folder's plugin.json. KINDS is built from those files, loaded by path, so a new kind is a new folder and no edit here
(docs/history/plant-plugin-design-2026-11-24.md). The plant folders are the ones the runner names in BENCH_PLANT_DIRS,
else every folder of bench/plants (sim.PLANT_FOLDERS).
"""
import importlib.util
import json
import os

from sim import PLANT_FOLDERS, PLANTS_DIR

from .plant_kind import PlantKind


def _load_file(path):
    """The (ENV_KIND, KIND) a kind file at `path` defines. Raises ValueError when it defines either wrongly."""
    # The plant folder names the module, since every built-in kind file is called kind.py.
    stem = os.path.basename(os.path.dirname(path)) + "_" + os.path.splitext(os.path.basename(path))[0]
    name = "plant_kind_" + stem.replace("-", "_")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    env_kind = getattr(module, "ENV_KIND", None)
    if not isinstance(env_kind, str) or not env_kind:
        raise ValueError(f"kind file {path} must define ENV_KIND, a non-empty string")
    if not isinstance(getattr(module, "KIND", None), PlantKind):
        raise ValueError(f"kind file {path}: KIND must be a PlantKind")
    return env_kind, module.KIND


def load_kinds(paths):
    """{ENV_KIND: KIND} over the kind files `paths`, in their order. Raises ValueError when two name one kind."""
    out = {}
    for path in paths:
        env_kind, kind = _load_file(path)
        if env_kind in out:
            raise ValueError(f"two kind files name {env_kind!r}; the second is {path}")
        out[env_kind] = kind
    return out


def _manifests(folders):
    """(folder, plugin.json dict) for each of `folders` with a plugin.json, in its "order", then folder name."""
    out = []
    for folder in folders:
        path = os.path.join(folder, "plugin.json")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                out.append((folder, json.load(f)))
    return sorted(out, key=lambda fm: (fm[1]["order"], os.path.basename(fm[0])))


def plant_kind_files(folders):
    """The kind file of each plant folder in `folders` (its plugin.json `entry` field), in plugin.json "order"."""
    return [os.path.join(folder, m["entry"]) for folder, m in _manifests(folders)]


def load_plants(folders):
    """{ENV_KIND: KIND} over the plant folders `folders`. Raises ValueError when a kind file's ENV_KIND is not its
    folder name (the name the Node side keys the kind by)."""
    out = load_kinds(plant_kind_files(folders))
    for (path, _), env_kind in zip(_manifests(folders), out):
        folder = os.path.basename(path)
        if env_kind != folder:
            raise ValueError(f"ENV_KIND {env_kind!r} must equal its plant folder name {folder!r}")
    return out


KIND_FILES = tuple(plant_kind_files(PLANT_FOLDERS))
KINDS = load_plants(PLANT_FOLDERS)
# None when the runner named no folder for that kind.
CONVEYOR = KINDS.get("conveyor-sim")
ARM = KINDS.get("arm-sim")

__all__ = ["PlantKind", "KINDS", "KIND_FILES", "PLANT_FOLDERS", "PLANTS_DIR", "CONVEYOR", "ARM", "load_kinds", "load_plants", "plant_kind_files"]
