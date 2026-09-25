// SPDX-License-Identifier: Apache-2.0
// The five commands as functions over the two files. Nothing here prints;
// cli.ts turns the returned results into text and exit codes.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { lockOptionsFromEnv, withLock } from "./lock";
import {
  findRepoRoot,
  isRegularFileOrDir,
  lockPath,
  projectIdentity,
  resolveArtifact,
  resolveSkillPath,
  validateSlug,
  workflowPath,
  workstreamPath,
  workstreamsDir,
} from "./paths";
import { dependenciesOf, type Gate, type StepState, type Workflow, type WorkflowStep, type Workstream } from "./schema";
import { FlowError, readWorkflow, readWorkstream, writeWorkstream } from "./store";

export interface Context {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

function nowIso(ctx: Context): string {
  return (ctx.now ?? (() => new Date()))().toISOString();
}

function load(ctx: Context, slug: string): { root: string; wf: Workflow; ws: Workstream; wsPath: string } {
  validateSlug(slug);
  const root = findRepoRoot(ctx.cwd);
  const wsPath = workstreamPath(root, slug);
  const ws = readWorkstream(wsPath);
  if (ws.project.root !== root) {
    throw new FlowError(
      `workstream ${slug} belongs to ${ws.project.root}, not ${root}; run fuse-flow from that repository`,
    );
  }
  const wf = readWorkflow(resolveArtifact(root, ws.workflow));
  return { root, wf, ws, wsPath };
}

function stepOf(wf: Workflow, id: string): WorkflowStep {
  const step = wf.steps.find((s) => s.id === id);
  if (!step) throw new FlowError(`unknown step "${id}"; steps are: ${wf.steps.map((s) => s.id).join(", ")}`);
  return step;
}

function stateOf(ws: Workstream, id: string): StepState {
  let st = ws.steps[id];
  if (!st) {
    st = { status: "pending", artifacts: [], fix_cycles: 0, notes: [] };
    ws.steps[id] = st;
  }
  return st;
}

function unmetDependencies(wf: Workflow, ws: Workstream, step: WorkflowStep): string[] {
  return dependenciesOf(wf, step).filter((dep) => ws.steps[dep]?.status !== "done");
}

// ---------------------------------------------------------------- start

export interface StartResult {
  root: string;
  slug: string;
  resumed: boolean;
  workstreamFile: string;
  workflowFile: string;
  stepsAdded: string[];
}

export function start(ctx: Context, slug: string, workflowSource?: string): StartResult {
  validateSlug(slug);
  const root = findRepoRoot(ctx.cwd);
  const wfPath = workflowPath(root);

  if (workflowSource !== undefined) {
    const src = resolveArtifact(ctx.cwd, workflowSource);
    if (!existsSync(src)) throw new FlowError(`no workflow file at ${src}`);
    readWorkflow(src); // validate before copying
    if (existsSync(wfPath)) {
      if (readFileSync(wfPath, "utf8") !== readFileSync(src, "utf8")) {
        throw new FlowError(`${wfPath} exists and differs from ${src}; remove it first if you mean to replace it`);
      }
    } else {
      mkdirSync(workstreamsDir(root), { recursive: true });
      copyFileSync(src, wfPath);
    }
  }
  if (!existsSync(wfPath)) {
    throw new FlowError(`no ${wfPath}; pass --workflow <path> to install one (fuse/flow/workflows/_k-full-sdlc.yml is the default)`);
  }
  const wf = readWorkflow(wfPath);
  const wsPath = workstreamPath(root, slug);
  const identity = projectIdentity(root, slug);
  const ts = nowIso(ctx);

  return withLock(lockPath(root, slug), lockOptionsFromEnv(ctx.env), () => {
    if (existsSync(wsPath)) {
      const ws = readWorkstream(wsPath);
      if (ws.project.identity !== identity || ws.project.root !== root) {
        throw new FlowError(
          `workstream ${slug} at ${wsPath} was minted for ${ws.project.root}; this repository is ${root}`,
        );
      }
      const stepsAdded: string[] = [];
      for (const step of wf.steps) {
        if (!ws.steps[step.id]) {
          stateOf(ws, step.id);
          stepsAdded.push(step.id);
        }
      }
      if (stepsAdded.length > 0) {
        ws.updated = ts;
        writeWorkstream(wsPath, ws);
      }
      return { root, slug, resumed: true, workstreamFile: wsPath, workflowFile: wfPath, stepsAdded };
    }
    const ws: Workstream = {
      version: 1,
      slug,
      project: { root, identity },
      workflow: relative(root, wfPath),
      created: ts,
      updated: ts,
      steps: Object.fromEntries(
        wf.steps.map((s) => [s.id, { status: "pending" as const, artifacts: [], fix_cycles: 0, notes: [] }]),
      ),
    };
    writeWorkstream(wsPath, ws);
    return { root, slug, resumed: false, workstreamFile: wsPath, workflowFile: wfPath, stepsAdded: [] };
  });
}

// ----------------------------------------------------------------- next

export type NextResult =
  | { kind: "complete" }
  | {
      kind: "run";
      step: WorkflowStep;
      skillPath?: string;
      skillExists?: boolean;
      produces: string[];
      gate: Gate;
      doneCommand: string;
    }
  | { kind: "awaiting-owner"; step: WorkflowStep; artifacts: string[]; gateCommand: string }
  | { kind: "blocked"; step: WorkflowStep; fixCycles: number; notes: string[]; gateCommand: string }
  | { kind: "stuck"; waitingOn: Array<{ step: string; on: string[] }> };

export function next(ctx: Context, slug: string): NextResult {
  const { root, wf, ws } = load(ctx, slug);
  const waitingOn: Array<{ step: string; on: string[] }> = [];
  for (const step of wf.steps) {
    const st = ws.steps[step.id] ?? { status: "pending", artifacts: [], fix_cycles: 0, notes: [] };
    if (st.status === "done") continue;
    if (st.status === "awaiting-owner") {
      return {
        kind: "awaiting-owner",
        step,
        artifacts: st.artifacts,
        gateCommand: `fuse-flow gate ${slug} ${step.id} --owner-approved [--note "<why>"]`,
      };
    }
    if (st.status === "blocked") {
      return {
        kind: "blocked",
        step,
        fixCycles: st.fix_cycles,
        notes: st.notes,
        gateCommand: `fuse-flow gate ${slug} ${step.id} --owner-approved --note "<owner decision>"`,
      };
    }
    const unmet = unmetDependencies(wf, ws, step);
    if (unmet.length > 0) {
      waitingOn.push({ step: step.id, on: unmet });
      continue;
    }
    const skillPath = step.skill ? resolveSkillPath(root, step.skill, ctx.env) : undefined;
    const artifactArgs = step.produces.map((p) => `--artifact ${p}`).join(" ");
    return {
      kind: "run",
      step,
      skillPath,
      skillExists: skillPath ? existsSync(skillPath) : undefined,
      produces: step.produces,
      gate: step.gate,
      doneCommand: `fuse-flow done ${slug} ${step.id}${artifactArgs ? " " + artifactArgs : ""}`,
    };
  }
  if (waitingOn.length === 0) return { kind: "complete" };
  return { kind: "stuck", waitingOn };
}

// ----------------------------------------------------------------- done

export type DoneResult =
  | { kind: "done"; step: string; status: "done" | "awaiting-owner"; artifacts: string[] }
  | { kind: "refused"; step: string; reason: string; fixCycles?: number; blocked?: boolean };

function runCheck(root: string, command: string, env: NodeJS.ProcessEnv, slug: string, step: string) {
  const proc = Bun.spawnSync(["sh", "-c", command], {
    cwd: root,
    env: { ...env, FUSE_FLOW_SLUG: slug, FUSE_FLOW_STEP: step },
    stdout: "pipe",
    stderr: "pipe",
  });
  const tail = (buf: Uint8Array) => new TextDecoder().decode(buf).trim().split("\n").slice(-10).join("\n");
  return { exitCode: proc.exitCode, stdout: tail(proc.stdout), stderr: tail(proc.stderr) };
}

export function done(ctx: Context, slug: string, stepId: string, artifacts: string[]): DoneResult {
  validateSlug(slug);
  const env = ctx.env ?? process.env;
  const repoRoot = findRepoRoot(ctx.cwd);

  // Read the state file only after the lock is held: a process that waited
  // for the lock must see what the previous holder wrote.
  return withLock(lockPath(repoRoot, slug), lockOptionsFromEnv(env), () => {
    const { root, wf, ws, wsPath } = load(ctx, slug);
    const step = stepOf(wf, stepId);
    const st = stateOf(ws, step.id);
    const ts = nowIso(ctx);
    const refuse = (reason: string, countAttempt: boolean): DoneResult => {
      if (!countAttempt) return { kind: "refused", step: step.id, reason };
      st.fix_cycles += 1;
      st.notes.push(`${ts} done refused: ${reason}`);
      let blocked = false;
      if (st.fix_cycles >= wf.max_fix_cycles) {
        st.status = "blocked";
        st.notes.push(`${ts} blocked after ${st.fix_cycles} failed attempts (max_fix_cycles ${wf.max_fix_cycles})`);
        blocked = true;
      }
      st.updated = ts;
      ws.updated = ts;
      writeWorkstream(wsPath, ws);
      return { kind: "refused", step: step.id, reason, fixCycles: st.fix_cycles, blocked };
    };

    if (st.status === "done") return refuse(`step "${step.id}" is already done`, false);
    if (st.status === "awaiting-owner") {
      return refuse(`step "${step.id}" already has its artifacts and awaits owner approval`, false);
    }
    if (st.status === "blocked") {
      return refuse(`step "${step.id}" is blocked after ${st.fix_cycles} failed attempts; the owner must decide`, false);
    }
    const unmet = unmetDependencies(wf, ws, step);
    if (unmet.length > 0) return refuse(`step "${step.id}" waits on: ${unmet.join(", ")}`, false);

    const recorded = Array.from(new Set([...step.produces, ...artifacts]));
    const missing = recorded.filter((a) => !isRegularFileOrDir(resolveArtifact(root, a)));
    if (missing.length > 0) return refuse(`missing artifact(s): ${missing.join(", ")}`, true);

    if (step.gate.kind === "check") {
      const r = runCheck(root, step.gate.command, env, slug, step.id);
      if (r.exitCode !== 0) {
        const detail = [r.stderr, r.stdout].filter(Boolean).join("\n");
        return refuse(`check failed (exit ${r.exitCode}): ${step.gate.command}${detail ? "\n" + detail : ""}`, true);
      }
    }

    st.artifacts = recorded;
    st.updated = ts;
    if (step.gate.kind === "owner") {
      st.status = "awaiting-owner";
      st.notes.push(`${ts} artifacts recorded; awaiting owner approval`);
    } else {
      st.status = "done";
      st.gate = { outcome: step.gate.kind === "check" ? "check-passed" : "none", at: ts };
    }
    ws.updated = ts;
    writeWorkstream(wsPath, ws);
    return { kind: "done", step: step.id, status: st.status, artifacts: recorded };
  });
}

// ----------------------------------------------------------------- gate

export type GateResult =
  | { kind: "approved"; step: string; previous: string }
  | { kind: "refused"; step: string; reason: string };

export function gate(ctx: Context, slug: string, stepId: string, opts: { ownerApproved: boolean; note?: string }): GateResult {
  validateSlug(slug);
  const repoRoot = findRepoRoot(ctx.cwd);
  if (!opts.ownerApproved) {
    return { kind: "refused", step: stepId, reason: "gate records owner approval only; pass --owner-approved" };
  }
  return withLock(lockPath(repoRoot, slug), lockOptionsFromEnv(ctx.env), () => {
    const { root, wf, ws, wsPath } = load(ctx, slug);
    const step = stepOf(wf, stepId);
    const st = stateOf(ws, step.id);
    if (st.status !== "awaiting-owner" && st.status !== "blocked") {
      return {
        kind: "refused" as const,
        step: step.id,
        reason: `step "${step.id}" is ${st.status}; only a step awaiting the owner or blocked can be approved`,
      };
    }
    const ts = nowIso(ctx);
    const previous = st.status;
    st.status = "done";
    st.gate = { outcome: "owner-approved", at: ts, ...(opts.note ? { note: opts.note } : {}) };
    st.notes.push(`${ts} owner approved${opts.note ? `: ${opts.note}` : ""}`);
    st.updated = ts;
    ws.updated = ts;
    writeWorkstream(wsPath, ws);
    return { kind: "approved" as const, step: step.id, previous };
  });
}

// --------------------------------------------------------------- status

export interface StatusRow {
  id: string;
  status: string;
  gate: Gate;
  fixCycles: number;
  artifacts: string[];
  waitingOn: string[];
}

export interface StatusResult {
  slug: string;
  root: string;
  workflow: string;
  workflowName: string;
  rows: StatusRow[];
  complete: boolean;
}

export function status(ctx: Context, slug: string): StatusResult {
  const { root, wf, ws } = load(ctx, slug);
  const rows = wf.steps.map((step) => {
    const st = ws.steps[step.id] ?? { status: "pending", artifacts: [], fix_cycles: 0, notes: [] };
    return {
      id: step.id,
      status: st.status,
      gate: step.gate,
      fixCycles: st.fix_cycles,
      artifacts: st.artifacts,
      waitingOn: st.status === "pending" ? unmetDependencies(wf, ws, step) : [],
    };
  });
  return {
    slug,
    root,
    workflow: ws.workflow,
    workflowName: wf.name,
    rows,
    complete: rows.every((r) => r.status === "done"),
  };
}
