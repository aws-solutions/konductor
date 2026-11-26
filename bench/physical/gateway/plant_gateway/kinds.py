# SPDX-License-Identifier: Apache-2.0
"""The plant kinds the gateway can run (conveyor, arm): what each one brings to a run. Never decides a call.

Each kind lives in its own kind file, which defines `ENV_KIND` (the `environment.kind` a task writes) and `KIND` (a
PlantKind). Since B-003 step 3b the kind file is `bench/plants/<kind>/kind.py`, named by the `python` field of that
folder's plant.json. KINDS is built from those files, loaded by path, so a new kind is a new folder and no edit here
(docs/history/plant-plugin-design-2026-11-24.md).
shortcut: the gateway finds bench/plants by its own path; the design's later step passes the folder in from the runner.
"""
import importlib.util
import json
import os

from .plant_kind import PlantKind

PLANTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "plants")


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


def _manifests(plants_dir):
    """(folder name, plant.json dict) for each folder of `plants_dir` with a plant.json, in its "order", then name."""
    out = []
    for name in os.listdir(plants_dir):
        path = os.path.join(plants_dir, name, "plant.json")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                out.append((name, json.load(f)))
    return sorted(out, key=lambda nm: (nm[1]["order"], nm[0]))


def plant_kind_files(plants_dir):
    """The kind file of each plant folder in `plants_dir` (its plant.json `python` field), in plant.json "order"."""
    return [os.path.join(plants_dir, name, m["python"]) for name, m in _manifests(plants_dir)]


def load_plants(plants_dir):
    """{ENV_KIND: KIND} over the plant folders of `plants_dir`. Raises ValueError when a kind file's ENV_KIND is not
    its folder name (the name the Node side keys the kind by)."""
    out = load_kinds(plant_kind_files(plants_dir))
    for (folder, _), env_kind in zip(_manifests(plants_dir), out):
        if env_kind != folder:
            raise ValueError(f"ENV_KIND {env_kind!r} must equal its plant folder name {folder!r}")
    return out


KIND_FILES = tuple(plant_kind_files(PLANTS_DIR))
KINDS = load_plants(PLANTS_DIR)
CONVEYOR = KINDS["conveyor-sim"]
ARM = KINDS["arm-sim"]

__all__ = ["PlantKind", "KINDS", "KIND_FILES", "PLANTS_DIR", "CONVEYOR", "ARM", "load_kinds", "load_plants", "plant_kind_files"]
