"""Rough host count for a peak day (2024 numbers)."""
PEAK_RPM = 1400
PER_HOST_RPM = 450
HEADROOM = 1.3

print(round(PEAK_RPM * HEADROOM / PER_HOST_RPM + 0.5))
