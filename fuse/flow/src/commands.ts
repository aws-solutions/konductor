// SPDX-License-Identifier: Apache-2.0
// The five fuse-flow commands. Each returns the lines to print, or throws a
// FlowError whose message says why the command was refused.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FlowError } from "./errors.ts";
import { findSkill, findWorkflow, workstreamFile } from "./project.ts";
import { dependenciesOf, describeGate, findStep, loadWorkflow, type Step, type Workflow } from "./workflow.ts";
import { readWorkstream, stateOf, updateWorkstream, workstreamExists, type Workstream } from "./workstream.ts";

// How the follow-up commands fuse-flow prints start. The fuse-flow script
// sets FUSE_FLOW_COMMAND to its own absolute path, so a printed command works
// without fuse-flow being on PATH.
const FUSE_FLOW = shellQuote(process.env.FUSE_FLOW_COMMAND || "fuse-flow");

// A path that the shell reads as one word, even with spaces or quotes in it.
function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

function stamp(event: string): string {
  return `${new Date().toISOString()} ${event}`;
}

function unmetDependencies(wf: Workflow, ws: Workstream, step: Step): string[] {
  return dependenciesOf(wf, step).filter((dep) => stateOf(ws, dep).status !== "done");
}

// The workflow a workstream follows, read fresh on every command, so an edit
// to the workflow file takes effect straight away.
function workflowOf(root: string, ws: Workstream): Workflow {
  return loadWorkflow(findWorkflow(root, ws.workflow));
}

// --------------------------------------------------------------------- start
// Mint a workstream that follows `workflowRef` (a workflow name or an
// absolute path), or resume the one that exists.

export function start(root: string, slug: string, workflowRef?: string): string[] {
  const resumed = workstreamExists(root, slug);
  let ref = workflowRef;
  if (resumed) {
    const recorded = readWorkstream(root, slug).workflow;
    if (ref !== undefined && ref !== recorded) {
      throw new FlowError(`workstream ${slug} follows workflow ${recorded}, not ${ref}`);
    }
    ref = recorded;
  } else if (ref === undefined) {
    throw new FlowError(`a new workstream needs --workflow <name or path>, for example --workflow _k-full-sdlc`);
  }
  const path = findWorkflow(root, ref);
  const wf = loadWorkflow(path);
  // List every step in the state file, so it reads as a complete checklist.
  updateWorkstream(root, slug, (ws) => wf.steps.forEach((step) => stateOf(ws, step.id)), { workflow: ref, steps: {} });
  return [
    `${resumed ? "resumed" : "minted"} workstream ${slug}`,
    `workflow: ${path}`,
    `state:    ${workstreamFile(root, slug)}`,
    `next: ${FUSE_FLOW} next ${slug}`,
  ];
}

// ---------------------------------------------------------------------- next
// The next step is the first one in file order that is not done and whose
// dependencies are all done. Because a step only depends on earlier steps,
// such a step always exists until the whole workflow is done.

export function next(root: string, slug: string): string[] {
  const ws = readWorkstream(root, slug);
  return describeNext(root, slug, workflowOf(root, ws), ws);
}

// `done` and `gate` call this while they hold the lock, with the workflow they
// validated and the state they are about to write, so the step they print is
// the one that is next when their change lands.
function describeNext(root: string, slug: string, wf: Workflow, ws: Workstream): string[] {
  const step = wf.steps.find((s) => stateOf(ws, s.id).status !== "done" && unmetDependencies(wf, ws, s).length === 0);
  if (!step) return ["workflow complete"];

  const state = stateOf(ws, step.id);
  const gateCommand = `${FUSE_FLOW} gate ${slug} ${step.id} --owner-approved`;
  switch (state.status) {
    case "awaiting-owner":
      return [
        `step: ${step.id} awaits owner approval`,
        `ask the owner to review: ${state.artifacts.join(", ") || "(no artifacts)"}`,
        `after the owner approves, run: ${gateCommand} [--note "<what the owner said>"]`,
      ];
    case "blocked":
      return [
        `step: ${step.id} is blocked after ${state.fix_cycles} refused attempts`,
        ...state.history.slice(-3).map((line) => `  ${line}`),
        `ask the owner how to proceed; if the owner accepts the step as it is, run: ` +
          `${gateCommand} --note "<the owner's decision>"`,
      ];
    default: {
      const lines = [`step: ${step.id}${step.title ? ` (${step.title})` : ""}`];
      if (step.skill) {
        const path = findSkill(root, step.skill);
        lines.push(`read: ${path ?? `${step.skill}   (not found; set FUSE_SKILLS_DIR)`}`);
      }
      if (step.instruction) lines.push(`instruction: ${step.instruction.trim()}`);
      lines.push(`produce: ${step.produces.join(", ") || "(nothing declared)"}`);
      lines.push(`gate: ${describeGate(step.gate)}`);
      lines.push(`then run: ${FUSE_FLOW} done ${slug} ${step.id}`);
      return lines;
    }
  }
}

// ---------------------------------------------------------------------- done
// Record that a pending step's work is finished. Accepted only when every
// artifact exists and the step's check command (if any) exits 0. A refusal
// for a missing artifact or a failed check costs one fix cycle; after
// max_fix_cycles of them the step is blocked until the owner decides. On
// success it prints what `next` would print, so the agent can carry on.

export function done(root: string, slug: string, stepId: string, extraArtifacts: string[]): string[] {
  const initial = readWorkstream(root, slug);
  const wf = workflowOf(root, initial);
  const step = findStep(wf, stepId);
  requireRunnable(wf, initial, step);

  const artifacts = [...new Set([...step.produces, ...extraArtifacts])];
  const missing = artifacts.filter((a) => !existsSync(resolve(root, a)));
  if (missing.length > 0) throw countRefusal(root, slug, wf, step, `missing artifact(s): ${missing.join(", ")}`);

  // The check runs without holding the state file's lock, so a long test run
  // does not stall fuse-flow commands for other steps.
  if (step.gate.kind === "check") {
    const check = runCheck(root, step.gate.command, slug, step.id);
    if (check.exitCode !== 0) {
      const reason = `check failed (exit ${check.exitCode ?? "none, killed by a signal"}): ${step.gate.command}`;
      throw countRefusal(root, slug, wf, step, reason, check.output);
    }
  }

  const awaitsOwner = step.gate.kind === "owner";
  let followUp: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const state = requireRunnable(wf, ws, step); // unchanged while the check ran?
    state.artifacts = artifacts;
    state.status = awaitsOwner ? "awaiting-owner" : "done";
    state.history.push(stamp(awaitsOwner ? "artifacts recorded; awaiting owner approval" : "done"));
    followUp = describeNext(root, slug, wf, ws);
  });
  return [
    `recorded ${step.id}: ${artifacts.join(", ") || "(no artifacts)"}`,
    awaitsOwner ? `${step.id} now awaits owner approval` : `${step.id} done`,
    "",
    ...followUp,
  ];
}

// A step can take `done` only while it is pending with its dependencies done.
// Refusing for any other reason costs no fix cycle.
function requireRunnable(wf: Workflow, ws: Workstream, step: Step) {
  const state = stateOf(ws, step.id);
  if (state.status !== "pending") throw new FlowError(`step "${step.id}" is ${state.status}, not pending`);
  const unmet = unmetDependencies(wf, ws, step);
  if (unmet.length > 0) throw new FlowError(`step "${step.id}" waits on: ${unmet.join(", ")}`);
  return state;
}

// Record a refused attempt on the step, blocking it when that was the last
// fix cycle, and return the error that tells the caller why.
function countRefusal(root: string, slug: string, wf: Workflow, step: Step, reason: string, output = "") {
  let fixCycles = 0;
  updateWorkstream(root, slug, (ws) => {
    const state = requireRunnable(wf, ws, step);
    state.fix_cycles += 1;
    state.history.push(stamp(`done refused: ${reason}`));
    if (state.fix_cycles >= wf.max_fix_cycles) state.status = "blocked";
    fixCycles = state.fix_cycles;
  });
  const blocked = fixCycles >= wf.max_fix_cycles ? " (the step is now blocked)" : "";
  return new FlowError(
    [reason, output, `fix cycles used on ${step.id}: ${fixCycles} of ${wf.max_fix_cycles}${blocked}`]
      .filter(Boolean)
      .join("\n"),
  );
}

// Runs from the repository root with the caller's environment, like a
// Makefile target. Keeps only the end of the output: enough to see why it
// failed without flooding the agent's context.
function runCheck(root: string, command: string, slug: string, stepId: string) {
  const proc = spawnSync("sh", ["-c", command], {
    cwd: root,
    env: { ...process.env, FUSE_FLOW_SLUG: slug, FUSE_FLOW_STEP: stepId },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024, // a test suite can print a lot; keep it all, then trim
  });
  if (proc.error) throw proc.error;
  const text = (proc.stdout + proc.stderr).trim();
  return { exitCode: proc.status, output: text.split("\n").slice(-20).join("\n") };
}

// ---------------------------------------------------------------------- gate
// Record the owner's approval of a step that awaits it, or the owner's
// decision to accept a blocked step as it is. Either way the step is done,
// and it prints what `next` would print.

export function gate(root: string, slug: string, stepId: string, note?: string): string[] {
  const wf = workflowOf(root, readWorkstream(root, slug));
  const step = findStep(wf, stepId);
  let followUp: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const state = stateOf(ws, step.id);
    if (state.status !== "awaiting-owner" && state.status !== "blocked") {
      throw new FlowError(
        `step "${step.id}" is ${state.status}; only a step awaiting the owner or blocked can be approved`,
      );
    }
    state.status = "done";
    state.history.push(stamp(`owner approved${note ? `: ${note}` : ""}`));
    followUp = describeNext(root, slug, wf, ws);
  });
  return [`${step.id}: owner approved; step done`, "", ...followUp];
}

// -------------------------------------------------------------------- status

export function status(root: string, slug: string): string[] {
  const ws = readWorkstream(root, slug);
  const wf = workflowOf(root, ws);
  const width = Math.max(...wf.steps.map((s) => s.id.length));
  const rows = wf.steps.map((step) => {
    const state = stateOf(ws, step.id);
    const unmet = state.status === "pending" ? unmetDependencies(wf, ws, step) : [];
    const details = [
      state.fix_cycles > 0 ? `fix cycles ${state.fix_cycles}` : "",
      unmet.length > 0 ? `waits on ${unmet.join(", ")}` : "",
      state.artifacts.join(", "),
    ].filter(Boolean);
    const columns = [step.id.padEnd(width), state.status.padEnd(14), `gate ${describeGate(step.gate).padEnd(6)}`];
    return `  ${[...columns, details.join("; ")].join("  ")}`.trimEnd();
  });
  const complete = wf.steps.every((step) => stateOf(ws, step.id).status === "done");
  return [`workstream ${slug} (${wf.name})`, ...rows, complete ? "workflow complete" : `next: ${FUSE_FLOW} next ${slug}`];
}
