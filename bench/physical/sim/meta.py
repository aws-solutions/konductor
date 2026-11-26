# SPDX-License-Identifier: Apache-2.0
"""Reads the tool and rule metadata shared with the Node scorer (bench/plants/<kind>/meta.json). Never changes it."""
import json
import os
from dataclasses import dataclass

# bench/plants: one folder per plant kind, each with its meta.json (B-003 step 3b).
PLANTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "plants")
META_PATH = os.path.join(PLANTS, "conveyor-sim", "meta.json")
ARM_META_PATH = os.path.join(PLANTS, "arm-sim", "meta.json")
KNOWN_MAJOR = 1
SETTLE_MS = 10_000
SETTLE_TICK_MS = 500


class MetaVersionError(ValueError):
    """The metadata file names a major version this reader does not know."""


def read_meta(path=META_PATH):
    """The parsed metadata at `path`. Raises MetaVersionError unless its `version` is `plant-meta/<KNOWN_MAJOR>`."""
    with open(path, encoding="utf-8") as f:
        meta = json.load(f)
    if meta.get("version") != f"plant-meta/{KNOWN_MAJOR}":
        raise MetaVersionError(f"{path} is {meta.get('version')!r}; this reader knows plant-meta/{KNOWN_MAJOR}")
    return meta




@dataclass(frozen=True)
class PlantMeta:
    """The facts of one plant kind: `tools` in order, each tool's `sim_ms`, the `not_executed_ms` a refused call costs,
    the `motion_tools` that get attempt checks, the `attempt_rules` and each rule's `verdict_measure`."""

    tools: tuple
    sim_ms: dict
    not_executed_ms: int
    motion_tools: frozenset
    attempt_rules: frozenset
    verdict_measure: dict


def load_meta(path):
    """The PlantMeta read from the metadata file at `path` (see `read_meta`)."""
    meta = read_meta(path)
    return PlantMeta(
        tools=tuple(tool["name"] for tool in meta["tools"]),
        sim_ms={tool["name"]: tool["simMs"] for tool in meta["tools"]},
        not_executed_ms=meta["notExecutedMs"],
        motion_tools=frozenset(tool["name"] for tool in meta["tools"] if tool["motion"]),
        attempt_rules=frozenset(rule for rule, facts in meta["rules"].items() if facts["attemptSide"]),
        verdict_measure={rule: facts["verdictMeasure"] for rule, facts in meta["rules"].items()},
    )


META = read_meta()
_CONVEYOR = load_meta(META_PATH)
TOOLS, SIM_MS, NOT_EXECUTED_MS = _CONVEYOR.tools, _CONVEYOR.sim_ms, _CONVEYOR.not_executed_ms
MOTION_TOOLS, ATTEMPT_RULES, VERDICT_MEASURE = _CONVEYOR.motion_tools, _CONVEYOR.attempt_rules, _CONVEYOR.verdict_measure
