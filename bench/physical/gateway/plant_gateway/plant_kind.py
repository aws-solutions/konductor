# SPDX-License-Identifier: Apache-2.0
"""The PlantKind record: what one kind of plant brings to a run. A kind file defines one (see kinds.py)."""
from dataclasses import dataclass
from types import ModuleType
from typing import Callable, FrozenSet, Optional

from .tools import ToolSet


@dataclass(frozen=True)
class PlantKind:
    """One kind of plant.

    `name` is what a task's `environment.plant` says. `sim_version` goes into the startup line. `tools` is the MCP
    ToolSet. `approvable` lists the actions an approval record can cover. `rules` is the module with
    `attempt_rules`, `executed_harm`, `settle_harm` and `procedure_harm`. `state_type` builds a true state from a
    test-mode frame, which arrives as control op `test_op`. `build` makes the simulator from a task `environment`
    and a seeded `random.Random`. `context(sample, tool, args, now_ms, limits, approved)` builds the Cedar context.
    `check_limits(limits)` raises PolicyInvalid when the sensor limits lack what the kind needs. `fixed_rule` is the
    rule class a run uses when hello lists no Cedar policy, or None when the kind always needs one.
    """

    name: str
    sim_version: str
    tools: ToolSet
    approvable: FrozenSet[str]
    rules: ModuleType
    state_type: type
    test_op: str
    build: Callable
    context: Callable
    check_limits: Callable
    fixed_rule: Optional[type] = None
