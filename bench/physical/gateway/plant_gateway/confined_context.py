# SPDX-License-Identifier: Apache-2.0
"""The confined-space cell's Cedar context: the arm's context plus `goes_inside` and the cell panel in whole numbers.

Cedar has no decimal numbers in a plain context, so gas values go in tenths (20.9 % is 209) and the purge state in
basis points (0.08 is 800). Computed from the sensor sample, the arguments and the sensor limits only.
"""
from .arm_context import arm_decision_context
from .arm_context import validate_limits as validate_arm_limits
from .policy import PolicyInvalid

TANK, GAS, GAS_TEST = "tank", "gas", "gasTest"
NO_TEST = {"o2_dpct": 0, "lel_dpct": 0, "h2s_dppm": 0, "co_dppm": 0}


def _whole(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def validate_limits(limits):
    """Raises PolicyInvalid unless `limits` hold the arm's keep-out box, `tank.mouthXMm` and a `maxAgeMs` for `gas` and `gasTest`."""
    validate_arm_limits(limits)
    if not _whole(limits.entry(TANK).get("mouthXMm")):
        raise PolicyInvalid("sensor-limits.json needs tank {mouthXMm: whole mm}")
    for name in (GAS, GAS_TEST):
        if not _whole(limits.entry(name).get("maxAgeMs")):
            raise PolicyInvalid(f"sensor-limits.json needs {name} {{maxAgeMs: whole ms}}")


def _tenths(reading):
    return {"o2_dpct": round(reading["o2"] * 10), "lel_dpct": round(reading["lel"] * 10),
            "h2s_dppm": round(reading["h2s"] * 10), "co_dppm": round(reading["co"] * 10)}


def _within(reading, now_ms, limits, name):
    return reading is not None and now_ms - reading["t_ms"] <= limits.entry(name)["maxAgeMs"]


def confined_decision_context(sample, tool, args, now_ms, limits, approved):
    """The Cedar context for `tool` with `args` from the decision-time `sample`, sim time `now_ms`, SensorLimits `limits`
    and the gateway-set `approved` flag: the arm's fields, `goes_inside` (a move whose target is past the tank mouth)
    and `cell` (permit, alarm, meter and test freshness, the latest test in tenths, the purge in basis points)."""
    cell = sample["cell"]
    test = cell["test"]
    return {
        **arm_decision_context(sample, tool, args, now_ms, limits, approved),
        "goes_inside": tool == "move_to" and args["x_mm"] > limits.entry(TANK)["mouthXMm"],
        "cell": {
            "permit_live": cell["permit"] == "live", "alarm": cell["alarm"] is True, "inside": cell["inside"] is True,
            "gas_fresh": _within(cell["gas"], now_ms, limits, GAS),
            "test_taken": test is not None, "test_fresh": _within(test, now_ms, limits, GAS_TEST),
            "test": _tenths(test) if test is not None else dict(NO_TEST),
            "purge_bp": round(cell["purge_fraction"] * 10000),
        },
    }
