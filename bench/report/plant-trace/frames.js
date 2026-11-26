// SPDX-License-Identifier: Apache-2.0
'use strict';

// Still frames of an arm trial's key moments for the trace page (DEBT D-29). The drawing is plants/arm-sim/sim/arm_frames.py,
// run with the arm Python (MuJoCo); it redraws logged poses and never reruns the physics. A conveyor trial has no poses
// and gets no frames. Calls no model and no network.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PHYSICAL = path.join(__dirname, '..', '..', 'physical');
const REPO_VENV = path.join(__dirname, '..', '..', '..', '.venv', 'bin', 'python');
const TIMEOUT_MS = 120000;

/** The arm Python: BENCH_ARM_PYTHON, else the repo's .venv, else null (frames are then not drawn). */
const armPython = () => process.env.BENCH_ARM_PYTHON || (fs.existsSync(REPO_VENV) ? REPO_VENV : null);

const hasPoses = (worldText) => worldText.split('\n').some((l) => l.includes('"qpos"'));

/**
 * `{ frames: [{cause, why, t_ms, png_base64}], unavailable }` for the trial in `dir`, or null when it is not an arm trial
 * (its world log has no poses). `unavailable` is null when frames were drawn, else why not. `python` overrides armPython().
 * MUJOCO_GL defaults to egl, the headless backend; a host with libOSMesa can set osmesa.
 */
function framesFor(dir, { python = armPython() } = {}) {
  const world = path.join(dir, 'plant', 'world.jsonl');
  let text;
  try { text = fs.readFileSync(world, 'utf8'); } catch { return null; } // readTrial already refused a dir without one
  if (!hasPoses(text)) return null;
  if (!python) return { frames: [], unavailable: 'no arm Python (set BENCH_ARM_PYTHON to a Python with mujoco)' };
  const r = spawnSync(python, ['-m', 'sim.arm_frames', path.join(dir, 'plant', 'gateway.jsonl'), world], {
    cwd: PHYSICAL, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MUJOCO_GL: process.env.MUJOCO_GL || 'egl' },
  });
  if (r.error || r.status !== 0) return { frames: [], unavailable: `the arm Python could not run sim.arm_frames (${r.error?.message ?? `exit ${r.status}: ${String(r.stderr).trim().split('\n').at(-1)}`})` };
  try {
    const out = JSON.parse(r.stdout);
    return { frames: out.frames ?? [], unavailable: out.unavailable ?? null };
  } catch {
    return { frames: [], unavailable: 'sim.arm_frames printed something that is not JSON' };
  }
}

module.exports = { framesFor, armPython };
