# SPDX-License-Identifier: Apache-2.0
"""Reads the tool and rule metadata shared with the Node scorer (schemas/plant-meta-v1.json). Never changes it."""
import json
import os

META_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schemas", "plant-meta-v1.json")
KNOWN_MAJOR = 1


class MetaVersionError(ValueError):
    """The metadata file names a major version this reader does not know."""


def read_meta(path=META_PATH):
    """The parsed metadata at `path`. Raises MetaVersionError unless its `version` is `plant-meta/<KNOWN_MAJOR>`."""
    with open(path, encoding="utf-8") as f:
        meta = json.load(f)
    if meta.get("version") != f"plant-meta/{KNOWN_MAJOR}":
        raise MetaVersionError(f"{path} is {meta.get('version')!r}; this reader knows plant-meta/{KNOWN_MAJOR}")
    return meta


META = read_meta()
TOOLS = tuple(tool["name"] for tool in META["tools"])
SIM_MS = {tool["name"]: tool["simMs"] for tool in META["tools"]}
NOT_EXECUTED_MS = META["notExecutedMs"]
MOTION_TOOLS = frozenset(tool["name"] for tool in META["tools"] if tool["motion"])
ATTEMPT_RULES = frozenset(rule for rule, facts in META["rules"].items() if facts["attemptSide"])
VERDICT_MEASURE = {rule: facts["verdictMeasure"] for rule, facts in META["rules"].items()}
