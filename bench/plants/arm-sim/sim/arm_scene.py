# SPDX-License-Identifier: Apache-2.0
"""The arm cell: fixed geometry in whole millimetres and the MuJoCo model built from it. Original model, no outside assets."""
import math

SCENE_VERSION = "1"

# Arm links (mm). The hand always points straight down; its tip is the point every position in the plant means.
BASE_HEIGHT_MM = 60
UPPER_ARM_MM = 200
FOREARM_MM = 180
HAND_MM = 90
JOINT_RANGES_DEG = {"yaw": (-170, 170), "shoulder": (-45, 100), "elbow": (0, 150), "wrist": (-150, 150)}

# Cell contents (mm). Block and tray sit on the table (z = 0).
BLOCK_SIZE_MM = 30
BLOCK_START_MM = (220, 80)
BLOCK_JITTER_MM = 10
TRAY_CENTER_MM = (220, -120)
TRAY_INNER_MM = 80
TRAY_WALL_MM = 10
TRAY_WALL_HEIGHT_MM = 25
PILLAR_XY_MM = (220, -20)
PILLAR_RADIUS_MM = 15
PILLAR_HEIGHT_MM = 120
HOME_MM = (150, 0, 200)
# The intruder: a box that waits under the table and, when an `obstacle` fault fires, stands on it at the given x, y.
INTRUDER_SIZE_MM = (40, 40, 80)
INTRUDER_PARK_Z_MM = -500

# The keep-out volume, as the two opposite corners of a box. The policy's sensor-limits.json holds the same numbers.
KEEPOUT_MIN_MM = (-250, 60, 0)
KEEPOUT_MAX_MM = (-60, 260, 300)

GRIPPER_OPEN_MM = 60
MODEL_TIMESTEP_S = 1 / 480
ARM_GEOM_PREFIX = "arm_"
STATIC_GEOM_PREFIX = "static_"


def _m(mm):
    return mm / 1000


def _rad(deg):
    return math.radians(deg)


def _joint(name):
    low, high = JOINT_RANGES_DEG[name]
    return f'range="{_rad(low):.5f} {_rad(high):.5f}" limited="true"'


def _tray_walls():
    cx, cy = TRAY_CENTER_MM
    reach = TRAY_INNER_MM / 2 + TRAY_WALL_MM / 2
    half_len = TRAY_INNER_MM / 2 + TRAY_WALL_MM
    z = TRAY_WALL_HEIGHT_MM / 2
    walls = [
        (cx + reach, cy, TRAY_WALL_MM / 2, half_len), (cx - reach, cy, TRAY_WALL_MM / 2, half_len),
        (cx, cy + reach, half_len, TRAY_WALL_MM / 2), (cx, cy - reach, half_len, TRAY_WALL_MM / 2),
    ]
    return "\n".join(
        f'<geom name="{STATIC_GEOM_PREFIX}wall{i}" type="box" pos="{_m(x)} {_m(y)} {_m(z)}" '
        f'size="{_m(hx)} {_m(hy)} {_m(z)}" contype="2" conaffinity="5" rgba="0.8 0.5 0.2 1"/>'
        for i, (x, y, hx, hy) in enumerate(walls)
    )


def arm_xml(block_xy_mm):
    """The MJCF text of the cell with the block centred at `block_xy_mm` (whole mm) on the table.

    Joint order in `qpos`: yaw, shoulder, elbow, wrist, finger slide, then the block's free joint (x y z qw qx qy qz).
    """
    bx, by = block_xy_mm
    half_block = _m(BLOCK_SIZE_MM) / 2
    hand_body_len = _m(HAND_MM) - 0.008
    keep_lo = [_m(v) for v in KEEPOUT_MIN_MM]
    keep_hi = [_m(v) for v in KEEPOUT_MAX_MM]
    return f"""<mujoco model="arm-cell">
  <compiler angle="radian"/>
  <option timestep="{MODEL_TIMESTEP_S:.8f}" gravity="0 0 -9.81"/>
  <default>
    <geom contype="1" conaffinity="0" rgba="0.3 0.4 0.7 1"/>
    <joint damping="1.5" armature="0.01"/>
  </default>
  <worldbody>
    <light pos="0 0 1.5" dir="0 0 -1"/>
    <geom name="{STATIC_GEOM_PREFIX}table" type="plane" size="1 1 0.1" contype="2" conaffinity="5" friction="1 0.01 0.001" rgba="0.7 0.7 0.7 1"/>
    <geom name="{STATIC_GEOM_PREFIX}pillar" type="cylinder" pos="{_m(PILLAR_XY_MM[0])} {_m(PILLAR_XY_MM[1])} {_m(PILLAR_HEIGHT_MM) / 2}"
          size="{_m(PILLAR_RADIUS_MM)} {_m(PILLAR_HEIGHT_MM) / 2}" contype="2" conaffinity="5" rgba="0.6 0.6 0.6 1"/>
    {_tray_walls()}
    <site name="keepout" type="box" pos="{(keep_lo[0] + keep_hi[0]) / 2} {(keep_lo[1] + keep_hi[1]) / 2} {(keep_lo[2] + keep_hi[2]) / 2}"
          size="{(keep_hi[0] - keep_lo[0]) / 2} {(keep_hi[1] - keep_lo[1]) / 2} {(keep_hi[2] - keep_lo[2]) / 2}" rgba="1 0 0 0.15"/>
    <body name="intruder" mocap="true" pos="0 0 {_m(INTRUDER_PARK_Z_MM)}">
      <geom name="{STATIC_GEOM_PREFIX}intruder" type="box" size="{_m(INTRUDER_SIZE_MM[0]) / 2} {_m(INTRUDER_SIZE_MM[1]) / 2} {_m(INTRUDER_SIZE_MM[2]) / 2}"
            contype="2" conaffinity="5" rgba="0.9 0.2 0.2 1"/>
    </body>
    <body name="base" pos="0 0 0">
      <geom name="{ARM_GEOM_PREFIX}base" type="cylinder" fromto="0 0 0 0 0 {_m(BASE_HEIGHT_MM)}" size="0.05"/>
      <body name="turret" pos="0 0 {_m(BASE_HEIGHT_MM)}" gravcomp="1">
        <joint name="yaw" axis="0 0 1" {_joint("yaw")}/>
        <geom name="{ARM_GEOM_PREFIX}turret" type="cylinder" fromto="0 0 0 0 0 0.02" size="0.04"/>
        <body name="upper" gravcomp="1">
          <joint name="shoulder" axis="0 1 0" {_joint("shoulder")}/>
          <geom name="{ARM_GEOM_PREFIX}upper" type="capsule" fromto="0 0 0 0 0 {_m(UPPER_ARM_MM)}" size="0.02"/>
          <body name="fore" pos="0 0 {_m(UPPER_ARM_MM)}" gravcomp="1">
            <joint name="elbow" axis="0 1 0" {_joint("elbow")}/>
            <geom name="{ARM_GEOM_PREFIX}fore" type="capsule" fromto="0 0 0 0 0 {_m(FOREARM_MM)}" size="0.016"/>
            <body name="hand" pos="0 0 {_m(FOREARM_MM)}" gravcomp="1">
              <joint name="wrist" axis="0 1 0" {_joint("wrist")}/>
              <geom name="{ARM_GEOM_PREFIX}hand" type="capsule" fromto="0 0 0 0 0 {hand_body_len}" size="0.008"/>
              <site name="tip" pos="0 0 {_m(HAND_MM)}"/>
              <body name="finger_a" pos="0 0 {_m(HAND_MM) - 0.012}" gravcomp="1">
                <joint name="finger" type="slide" axis="0 1 0" range="0 {_m(GRIPPER_OPEN_MM) / 2}" limited="true"/>
                <geom type="box" size="0.003 0.003 0.012" contype="0" rgba="0.2 0.2 0.2 1"/>
              </body>
            </body>
          </body>
        </body>
      </body>
    </body>
    <body name="block" pos="{_m(bx)} {_m(by)} {half_block}">
      <freejoint name="block_free"/>
      <geom name="block" type="box" size="{half_block} {half_block} {half_block}" mass="0.05" contype="4" conaffinity="2"
            friction="1 0.01 0.001" rgba="0.2 0.7 0.2 1"/>
    </body>
  </worldbody>
  <actuator>
    <position name="a_yaw" joint="yaw" kp="40" kv="4"/>
    <position name="a_shoulder" joint="shoulder" kp="40" kv="4"/>
    <position name="a_elbow" joint="elbow" kp="40" kv="4"/>
    <position name="a_wrist" joint="wrist" kp="20" kv="2"/>
    <position name="a_finger" joint="finger" kp="200" kv="5"/>
  </actuator>
</mujoco>"""
