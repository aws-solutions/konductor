# SPDX-License-Identifier: Apache-2.0
"""The plant kinds the gateway can run (conveyor, arm): what each one brings to a run. Never decides a call.

Each kind lives in its own kind file, which defines `ENV_KIND` (the `environment.kind` a task writes) and `KIND` (a
PlantKind). KINDS is built from KIND_FILES, loaded by path, so a new kind is a new file and no edit here
(docs/history/plant-plugin-design-2026-11-24.md, step 2).
"""
import importlib.util
import os

from .plant_kind import PlantKind

KIND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kind_files")
KIND_FILES = (os.path.join(KIND_DIR, "conveyor.py"), os.path.join(KIND_DIR, "arm.py"), os.path.join(KIND_DIR, "arm_confined_space.py"))


def _load_file(path):
    """The (ENV_KIND, KIND) a kind file at `path` defines. Raises ValueError when it defines either wrongly."""
    name = "plant_kind_" + os.path.splitext(os.path.basename(path))[0]
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


KINDS = load_kinds(KIND_FILES)
CONVEYOR = KINDS["conveyor-sim"]
ARM = KINDS["arm-sim"]

__all__ = ["PlantKind", "KINDS", "KIND_FILES", "CONVEYOR", "ARM", "load_kinds"]
