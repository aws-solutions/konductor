# SPDX-License-Identifier: Apache-2.0
"""Closed-form inverse kinematics of the arm with its hand pointing straight down, and the keep-out box test. Pure functions."""
import math

from . import arm_scene as scene


class Unreachable(ValueError):
    """The hand tip cannot get to the asked position: out of reach or past a joint range."""


def joint_angles(x_mm, y_mm, z_mm):
    """The joint angles `(yaw, shoulder, elbow, wrist)` in radians that put the hand tip at (`x_mm`, `y_mm`, `z_mm`).

    Takes the elbow-up solution. Raises Unreachable when the tip is out of reach or a joint would pass its range.
    """
    yaw = math.atan2(y_mm, x_mm)
    reach = math.hypot(x_mm, y_mm)
    rise = z_mm + scene.HAND_MM - scene.BASE_HEIGHT_MM
    distance = math.hypot(reach, rise)
    cos_elbow = (distance ** 2 - scene.UPPER_ARM_MM ** 2 - scene.FOREARM_MM ** 2) / (2 * scene.UPPER_ARM_MM * scene.FOREARM_MM)
    if not -1 <= cos_elbow <= 1:
        raise Unreachable(f"({x_mm}, {y_mm}, {z_mm}) mm is out of reach")
    elbow = math.acos(cos_elbow)
    shoulder = math.atan2(reach, rise) - math.atan2(scene.FOREARM_MM * math.sin(elbow), scene.UPPER_ARM_MM + scene.FOREARM_MM * math.cos(elbow))
    wrist = math.pi - shoulder - elbow
    angles = {"yaw": yaw, "shoulder": shoulder, "elbow": elbow, "wrist": wrist}
    for name, value in angles.items():
        low, high = (math.radians(d) for d in scene.JOINT_RANGES_DEG[name])
        if not low <= value <= high:
            raise Unreachable(f"({x_mm}, {y_mm}, {z_mm}) mm needs the {name} joint at {math.degrees(value):.0f} degrees")
    return yaw, shoulder, elbow, wrist


def inside_keepout(point_mm, margin_mm=0):
    """True when `point_mm` (x, y, z) lies inside the keep-out box grown by `margin_mm` on every side."""
    return all(lo - margin_mm <= v <= hi + margin_mm for v, lo, hi in zip(point_mm, scene.KEEPOUT_MIN_MM, scene.KEEPOUT_MAX_MM))


def segment_hits_box(start_mm, end_mm, box_min_mm, box_max_mm):
    """True when the straight segment from `start_mm` to `end_mm` touches the box (slab test; both ends count as touching)."""
    enter, leave = 0.0, 1.0
    for a, b, lo, hi in zip(start_mm, end_mm, box_min_mm, box_max_mm):
        delta = b - a
        if delta == 0:
            if not lo <= a <= hi:
                return False
            continue
        near, far = sorted(((lo - a) / delta, (hi - a) / delta))
        enter, leave = max(enter, near), min(leave, far)
        if enter > leave:
            return False
    return True
