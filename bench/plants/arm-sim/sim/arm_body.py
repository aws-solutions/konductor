# SPDX-License-Identifier: Apache-2.0
"""The MuJoCo model of the arm cell: one control tick of physics, the hand tip, contacts and the block. Holds no run state."""
import contextlib

import mujoco
import numpy as np

from . import arm_scene as scene
from .arm_kinematics import joint_angles

CONTROL_HZ = 30
SUBSTEPS = round(1 / (CONTROL_HZ * scene.MODEL_TIMESTEP_S))
TICK_MS_NUMERATOR = 1000
CONTACT_DEPTH_M = 0.0005
POSE_DECIMALS = 5
ARM_JOINTS = 4
FINGER_DOF = ARM_JOINTS
BLOCK_QPOS = slice(ARM_JOINTS + 1, ARM_JOINTS + 8)
BLOCK_QVEL = slice(ARM_JOINTS + 1, ARM_JOINTS + 7)
TRAY_REST_Z_MM = 30


def ticks_in(ms):
    """How many whole control ticks fit in `ms` of sim time."""
    return ms * CONTROL_HZ // TICK_MS_NUMERATOR


class ArmBody:
    """The model and its physics state.

    `block_xy_mm` is where the block starts on the table. `qpos` order: yaw, shoulder, elbow, wrist, finger slide, then
    the block's free joint. Tick after tick, the same inputs always give the same poses on one machine and one MuJoCo build.
    """

    def __init__(self, block_xy_mm):
        self.model = mujoco.MjModel.from_xml_string(scene.arm_xml(block_xy_mm))
        self.data = mujoco.MjData(self.model)
        self._spare = mujoco.MjData(self.model)
        self._tip = self.model.site("tip").id
        names = [mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_GEOM, i) or "" for i in range(self.model.ngeom)]
        self._arm_geoms = np.array([n.startswith(scene.ARM_GEOM_PREFIX) for n in names])
        self._static_geoms = np.array([n.startswith(scene.STATIC_GEOM_PREFIX) for n in names])

    @contextlib.contextmanager
    def sandbox(self):
        """Within the block, every change to the physics state is undone on exit (the dry run)."""
        mujoco.mj_copyData(self._spare, self.model, self.data)
        try:
            yield
        finally:
            mujoco.mj_copyData(self.data, self.model, self._spare)

    def set_intruder(self, at_mm):
        """Stands the intruder box on the table at `at_mm` (x, y in whole mm), or parks it under the table when `at_mm` is None."""
        if at_mm is None:
            self.data.mocap_pos[0] = [0, 0, scene.INTRUDER_PARK_Z_MM / 1000]
        else:
            self.data.mocap_pos[0] = [at_mm[0] / 1000, at_mm[1] / 1000, scene.INTRUDER_SIZE_MM[2] / 2000]

    def place_hand(self, tip_mm, finger_mm):
        """Puts the hand tip at `tip_mm` with the finger at `finger_mm`, at rest (the start of a run)."""
        angles = joint_angles(*tip_mm)
        self.data.qpos[:ARM_JOINTS] = angles
        self.data.qpos[FINGER_DOF] = finger_mm / 2000
        self.data.qvel[:] = 0
        self.data.ctrl[:ARM_JOINTS] = angles
        self.data.ctrl[FINGER_DOF] = finger_mm / 2000
        mujoco.mj_forward(self.model, self.data)

    def tick(self, command_mm, finger_mm, carrying):
        """Runs one control tick: the tip is asked to be at `command_mm` (floats), the finger at `finger_mm`. While
        `carrying`, the block is held at the tip. Raises Unreachable when the command cannot be reached."""
        self.data.ctrl[:ARM_JOINTS] = joint_angles(*command_mm)
        self.data.ctrl[FINGER_DOF] = finger_mm / 2000
        for _ in range(SUBSTEPS):
            mujoco.mj_step(self.model, self.data)
            if carrying:
                self._hold_block_at_tip()

    def _hold_block_at_tip(self):
        self.data.qpos[BLOCK_QPOS] = [*self.data.site_xpos[self._tip], 1, 0, 0, 0]
        self.data.qvel[BLOCK_QVEL] = 0

    def tip_mm(self):
        """The hand tip as floats in mm."""
        return [float(v) * 1000 for v in self.data.site_xpos[self._tip]]

    def block_mm(self):
        """The block's centre as floats in mm."""
        return [float(v) * 1000 for v in self.data.qpos[BLOCK_QPOS][:3]]

    def block_is_moving(self):
        return bool(np.abs(self.data.qvel[BLOCK_QVEL]).max() > 1e-3)

    def block_in_tray(self):
        """True when the block rests inside the tray's inner square."""
        x, y, z = self.block_mm()
        cx, cy = scene.TRAY_CENTER_MM
        half = scene.TRAY_INNER_MM / 2
        return abs(x - cx) <= half and abs(y - cy) <= half and z <= TRAY_REST_Z_MM

    def arm_pushes_on_scene(self):
        """True when an arm part presses into a fixed object (table, pillar, tray) deeper than CONTACT_DEPTH_M."""
        contacts = self.data.contact[: self.data.ncon]
        if not len(contacts):
            return False
        first, second = contacts.geom1, contacts.geom2
        pair = (self._arm_geoms[first] & self._static_geoms[second]) | (self._static_geoms[first] & self._arm_geoms[second])
        return bool((pair & (contacts.dist < -CONTACT_DEPTH_M)).any())

    def pose(self):
        """The whole `qpos` as a list of floats rounded to POSE_DECIMALS, enough to redraw the cell with `mj_forward`."""
        return [round(float(v), POSE_DECIMALS) for v in self.data.qpos]
