# SPDX-License-Identifier: Apache-2.0
"""The confined-space tank's numbers, its mouth and its atmosphere: a seeded gas model with ventilation, a staged release and meter noise.

Pure Python, no MuJoCo, no wall clock; the only randomness is the `rng` given in. Ported from the stub-only pick 2 work
(workspace confined-space/cs/spec.py and gas.py), whose REQUIREMENTS-DESIGN.md says where each number comes from.
"""
import math

# The hand is inside the tank when its tip is past the mouth plane (x, mm).
MOUTH_X_MM = 180

# Alarm values. O2 is a band (both ends acceptable); LEL, H2S and CO alarm at the number itself.
O2_LOW_PCT, O2_HIGH_PCT = 19.5, 23.5
LEL_ALARM_PCT, H2S_ALARM_PPM, CO_ALARM_PPM = 10.0, 10.0, 35.0
GASES = ("o2", "lel", "h2s", "co")
FRESH_AIR = {"o2": 20.9, "lel": 0.0, "h2s": 0.0, "co": 0.0}

# Sim-time limits (ms).
TEST_MAX_AGE_MS = 600_000   # a passing test older than this does not open the entry gate
GAS_STALE_MS = 5_000        # no meter reading for this long while inside raises the alarm
EGRESS_MS = 30_000          # after an alarm the hand must be outside within this
READ_GAS_MS = 5_000         # one gas test
MAX_VENT_S = 600            # longest single ventilate call

# Ventilation: the contamination left is exp(-ventilated seconds / VENT_TAU_S) since the last release.
VENT_TAU_S = 120.0
PURGE_TARGET = 0.08

START_ATMOSPHERE = {"o2": 17.0, "lel": 14.0, "h2s": 60.0, "co": 80.0}
SPIKE_H2S_PPM = 40.0
NOISE_SD = {"o2": 0.05, "lel": 0.2, "h2s": 0.2, "co": 0.5}


def is_inside(hand_mm):
    """True when a hand tip at `hand_mm` (x, y, z in mm) is past the tank mouth."""
    return hand_mm[0] > MOUTH_X_MM


def failed_gases(reading):
    """The gases in `reading` (gas -> value) that are in alarm, in the order o2, lel, h2s, co."""
    failed = []
    if not O2_LOW_PCT <= reading["o2"] <= O2_HIGH_PCT:
        failed.append("o2")
    if reading["lel"] >= LEL_ALARM_PCT:
        failed.append("lel")
    if reading["h2s"] >= H2S_ALARM_PPM:
        failed.append("h2s")
    if reading["co"] >= CO_ALARM_PPM:
        failed.append("co")
    return failed


class GasField:
    """The tank's true atmosphere and the meter that reads it.

    `rng` (a `random.Random`) sets the meter noise. Each ventilated second multiplies every source's excess over fresh
    air by exp(-1/VENT_TAU_S); with no ventilation the atmosphere does not change.
    """

    def __init__(self, rng, start=START_ATMOSPHERE):
        self._rng = rng
        self._vent_s = 0.0
        self._purge_mark_s = 0.0
        # Each source is (gas, excess over fresh air, ventilated seconds when it appeared).
        self._sources = [(g, start[g] - FRESH_AIR[g], 0.0) for g in GASES]

    @property
    def purge_fraction(self):
        """The share of contamination left since the last release; 1.0 until the fans run."""
        return math.exp(-(self._vent_s - self._purge_mark_s) / VENT_TAU_S)

    def ventilate(self, seconds):
        """Runs the fans for `seconds` of sim time."""
        self._vent_s += seconds

    def spike(self, gas, amount):
        """A release: adds `amount` of `gas` now and restarts the purge."""
        self._sources.append((gas, amount, self._vent_s))
        self._purge_mark_s = self._vent_s

    def true_value(self, gas):
        """The real concentration of `gas`, with no meter noise."""
        return FRESH_AIR[gas] + sum(x * math.exp(-(self._vent_s - at) / VENT_TAU_S) for g, x, at in self._sources if g == gas)

    def read(self):
        """One meter reading of every gas: the true value plus noise, at least 0, rounded to 0.1."""
        return {g: round(max(0.0, self.true_value(g) + self._rng.gauss(0, NOISE_SD[g])), 1) for g in GASES}
