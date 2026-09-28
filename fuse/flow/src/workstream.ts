// SPDX-License-Identifier: Apache-2.0
// The state of one workstream, .konductor/workstreams/<slug>.yml: where each
// step stands. Only fuse-flow writes it, and git ignores it.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { FlowError } from "./errors.ts";
import { workstreamFile, workstreamsDir } from "./project.ts";

// pending         not done yet (the only status in which `done` is accepted)
// awaiting-owner  artifacts recorded, waiting for `fuse-flow gate`
// blocked         max_fix_cycles refused attempts; waiting for `fuse-flow gate`
// done            finished
const StepStateSchema = z
  .object({
    status: z.enum(["pending", "awaiting-owner", "blocked", "done"]),
    fix_cycles: z.number().int().min(0),
    artifacts: z.array(z.string()),
    history: z.array(z.string()),
  })
  .strict();

// Step id -> state. An object with a catchall rather than z.record, which
// refuses objects that have a "constructor" key, and "constructor" is a valid
// step id. `workflow` is the workflow the workstream follows, as given to
// `start`: a name, or an absolute path.
const WorkstreamSchema = z
  .object({ workflow: z.string().min(1), steps: z.object({}).catchall(StepStateSchema) })
  .strict();

export type StepState = z.infer<typeof StepStateSchema>;
export type Workstream = z.infer<typeof WorkstreamSchema>;

// A step the state file does not mention yet (for example one added to the
// workflow after `start`) is simply pending.
export function stateOf(ws: Workstream, stepId: string): StepState {
  // Object.hasOwn, not ??=: a step may be called "constructor".
  if (!Object.hasOwn(ws.steps, stepId)) {
    ws.steps[stepId] = { status: "pending", fix_cycles: 0, artifacts: [], history: [] };
  }
  return ws.steps[stepId];
}

export function workstreamExists(root: string, slug: string): boolean {
  return existsSync(workstreamFile(root, slug));
}

export function readWorkstream(root: string, slug: string): Workstream {
  const path = workstreamFile(root, slug);
  if (!existsSync(path)) throw new FlowError(`no workstream "${slug}" in ${root}; run fuse-flow start ${slug} first`);
  let yaml: unknown;
  try {
    yaml = YAML.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new FlowError(`${path} is not valid YAML: ${(e as Error).message}`);
  }
  const parsed = WorkstreamSchema.safeParse(yaml);
  if (!parsed.success) throw new FlowError(`${path} is not a valid workstream file; it is written by fuse-flow only`);
  return parsed.data;
}

// Read the state file, let `change` modify it, write it back. The lock makes
// the read and the write one step, so two fuse-flow processes working on the
// same workstream never overwrite each other's change. `initial` is the
// workstream to start from when the file does not exist yet.
export function updateWorkstream(
  root: string,
  slug: string,
  change: (ws: Workstream) => void,
  initial?: Workstream,
): void {
  prepareWorkstreamsDir(root);
  withLock(`${workstreamFile(root, slug)}.lock`, () => {
    const ws = initial && !workstreamExists(root, slug) ? initial : readWorkstream(root, slug);
    change(ws);
    // Write a temporary file and rename it over the old one, so an
    // interrupted write never leaves a half-written state file.
    const path = workstreamFile(root, slug);
    writeFileSync(`${path}.tmp`, YAML.stringify(WorkstreamSchema.parse(ws)));
    renameSync(`${path}.tmp`, path);
  });
}

// Workstream state is private to the engineer's checkout, so the directory
// carries its own .gitignore.
function prepareWorkstreamsDir(root: string): void {
  const dir = workstreamsDir(root);
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
}

const LOCK_WAIT_MS = 2000;

// The lock is held only for the few milliseconds of one read and write, never
// while a check command runs. A lock file left behind by a killed process is
// not removed automatically; the error names the file to delete.
function withLock(lockFile: string, fn: () => void): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeFileSync(lockFile, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (Date.now() > deadline) {
        throw new FlowError(`another fuse-flow process holds ${lockFile}; if none is running, delete that file`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); // sleep 20 ms
    }
  }
  try {
    fn();
  } finally {
    rmSync(lockFile, { force: true });
  }
}
