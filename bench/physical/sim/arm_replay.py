# SPDX-License-Identifier: Apache-2.0
"""Replay of a finished arm run from its logs (FR-41, v1): picks the key moments and redraws a logged pose as a still frame.

The physics is never run again: a frame loads a logged `qpos` into the same model and calls `mj_forward`. Drawing needs a
GL backend (MUJOCO_GL=osmesa on a CPU host). Never reads a live run and is never shown to the agent.
"""
import struct
import zlib

KEY_EVENTS = ("denied", "harm", "connection_lost")
FRAME_PX = 160


class RenderUnavailable(RuntimeError):
    """No GL backend could draw a frame on this host."""


def key_moments(events, world):
    """The moments worth a still frame, as `[{"cause", "why", "pose_index"}]` in run order.

    `events` and `world` are the parsed gateway and world logs. A moment is a denied call, a call that raised an unsafe
    flag, a harm line, a lost link, and the end of the run. `pose_index` is the index of the call's last pose in
    the run's flat pose list (see `flat_poses`), or None when the call left no pose.
    """
    ends = _last_pose_index_by_cause(world)
    moments = []
    for event in events:
        why = _why(event)
        cause = _cause_of(event)
        if why and cause in ends:
            moments.append({"cause": cause, "why": why, "pose_index": ends[cause]})
    if ends:
        last = list(ends)[-1]
        moments.append({"cause": last, "why": "end of run", "pose_index": ends[last]})
    return moments


def flat_poses(world):
    """Every logged pose of the run in order, as `(t_ms, qpos)` pairs."""
    return [(t, q) for line in world for t, q in zip(line.get("poses", {}).get("t_ms", []), line.get("poses", {}).get("qpos", []))]


def _last_pose_index_by_cause(world):
    ends, count = {}, 0
    for line in world:
        added = len(line.get("poses", {}).get("qpos", []))
        count += added
        if added:
            ends[line["cause"]] = count - 1
    return ends


def _cause_of(event):
    """The world-line cause of `event`: a call line names itself (`c<seq>`), a harm line its cause, the rest their call."""
    if event["type"] == "call":
        return f"c{event['seq']}"
    return event["cause"] if event["type"] == "harm" else event.get("call_id")


def _why(event):
    if event["type"] == "call" and event.get("unsafe"):
        return "unsafe try " + ",".join(event["unsafe"])
    return event["type"] if event["type"] in KEY_EVENTS else None


def png_bytes(rgb, width, height):
    """A PNG file for `rgb`, `height` rows of `width` RGB pixels as bytes (no imaging library needed)."""
    rows = b"".join(b"\x00" + rgb[y * width * 3:(y + 1) * width * 3] for y in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def render_frame(qpos, block_xy_mm, size_px=FRAME_PX):
    """A PNG of the cell with `qpos` loaded, the block starting at `block_xy_mm` (the model is built with it).

    Raises RenderUnavailable when MuJoCo cannot open a GL backend (set MUJOCO_GL=osmesa on a CPU host).
    """
    import mujoco

    from .arm_body import ArmBody

    body = ArmBody(block_xy_mm)
    body.data.qpos[:] = qpos
    mujoco.mj_forward(body.model, body.data)
    try:
        renderer = mujoco.Renderer(body.model, size_px, size_px)
    except Exception as e:  # MuJoCo raises a different type for each missing GL library
        raise RenderUnavailable(str(e)) from None
    try:
        renderer.update_scene(body.data)
        return png_bytes(renderer.render().tobytes(), size_px, size_px)
    finally:
        renderer.close()
