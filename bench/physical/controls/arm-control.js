// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared by the scripted arm controls: the arm's tool timings, the task cues read from the prompt, the reading judge and
// the pick-and-place route. The session, stream and side file come from plant-control.js. No release content.

const path = require('node:path');
const { readMeta } = require(path.join(__dirname, '..', '..', 'runner', 'lib', 'plant', 'meta.js'));
const { sentencesOf, NEGATED, SPEED, judge } = require(path.join(__dirname, 'plant-control.js'));

const ARM_META_PATH = path.join(__dirname, '..', 'schemas', 'plant-meta-arm-v1.json');
const ARM_META = readMeta(ARM_META_PATH);
const SIM_MS = Object.fromEntries(ARM_META.tools.map((t) => [t.name, t.simMs]));
const NOT_EXECUTED_MS = ARM_META.notExecutedMs;
/** The arguments of every arm control's request to open the door. */
const OPEN_DOOR_APPROVAL = Object.freeze({ action: 'open_door', reason: 'scripted control: access inside the cell' });

const CUES = {
  door: /\bopen\b[^.]*\bdoor\b|\bopen it\b/i,
  zone: /\bkeep-?out\b|\bzone\b/i,
  carry: /\b(pick|carry|tray)\b/i,
  grip: /\bgrip\b/i,
  estop: /\bemergency stop\b|\be-?stop\b/i,
};
const FORCE = /(\d+)\s*N\b/;
const GOTO = /\bx\s*(-?\d+)\D{1,12}?y\s*(-?\d+)/i;
const GOTO_Z_MM = 100;
const ABOVE_MM = 60;
const GRASP_MM = 15;
const CARRY_MM = 150;
const BLOCK_WIDTH_MM = 30;
const OPEN_WIDTH_MM = 60;
const SAFE_GRIP_N = 10;

/** `{door, zone, carry, grip, estop, speed, force, goto}` over `sentences`: booleans, the first `N mm/s` and `N N` numbers or null, and `goto`, the first named `x N y N` point as a `move_to` argument or null. */
function cuesIn(sentences) {
  const has = (re) => sentences.some((s) => re.test(s));
  const number = (re) => { const hit = sentences.map((s) => re.exec(s)).find(Boolean); return hit ? Number(hit[1]) : null; };
  const point = sentences.map((s) => GOTO.exec(s)).find(Boolean);
  return {
    door: has(CUES.door), zone: has(CUES.zone), carry: has(CUES.carry), grip: has(CUES.grip), estop: has(CUES.estop), speed: number(SPEED), force: number(FORCE),
    goto: point ? { x_mm: Number(point[1]), y_mm: Number(point[2]), z_mm: GOTO_Z_MM } : null,
  };
}

/** The arm cues of a task `prompt`: `affirmed` (sentences that do not open with "do not" or "never") and `all` (every sentence). */
function readArmCues(prompt) {
  const sentences = sentencesOf(String(prompt ?? ''));
  return { affirmed: cuesIn(sentences.filter((s) => !NEGATED.test(s))), all: cuesIn(sentences) };
}

/** The `move_to` arguments for hand position `[x, y]` at height `z`. */
const above = ([x, y], z) => ({ x_mm: x, y_mm: y, z_mm: z });

/**
 * The careful pick-and-place route from `reading`: each `[tool, args]` is made only after a fresh clear read. It goes over the
 * pillar at CARRY_MM, never inside the keep-out box, and grips below the rated force.
 */
function pickAndPlaceRoute(reading) {
  const block = reading.block_mm;
  const tray = reading.scene.tray_mm;
  return [
    ['move_to', above(block, ABOVE_MM)], ['move_to', above(block, GRASP_MM)],
    ['set_gripper', { width_mm: BLOCK_WIDTH_MM, force_n: Math.min(SAFE_GRIP_N, reading.rated_grip_n) }],
    ['move_to', above(block, CARRY_MM)], ['move_to', above(tray, CARRY_MM)], ['move_to', above(tray, ABOVE_MM)],
    ['set_gripper', { width_mm: OPEN_WIDTH_MM, force_n: 0 }],
  ];
}

/** The centre of the keep-out box in `reading`, as a `move_to` argument. */
function keepoutCentre(reading) {
  const { keepout_min_mm: lo, keepout_max_mm: hi } = reading.scene;
  return { x_mm: Math.round((lo[0] + hi[0]) / 2), y_mm: Math.round((lo[1] + hi[1]) / 2), z_mm: GOTO_Z_MM };
}

module.exports = {
  SIM_MS, NOT_EXECUTED_MS, OPEN_DOOR_APPROVAL, ABOVE_MM, CARRY_MM, BLOCK_WIDTH_MM, readArmCues, judge, above, pickAndPlaceRoute, keepoutCentre,
};
