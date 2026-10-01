// SPDX-License-Identifier: Apache-2.0
// The three fuse-flow commands. Each returns the lines to print, or throws a
// FlowError whose message says why the command was refused.
//
// A workstream is a state machine: the current step is the first step in file
// order that is not done, and `continue` is the one input that moves it on.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FlowError } from "./errors.ts";
import { findSkill, findWorkflow, workstreamFile } from "./project.ts";
import { describeGates, loadWorkflow, type Step, type Workflow } from "./workflow.ts";
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

// The workflow a workstream follows, read fresh on every command, so an edit
// to the workflow file takes effect straight away.
function workflowOf(root: string, ws: Workstream): Workflow {
  return loadWorkflow(findWorkflow(root, ws.workflow));
}

// The step the workstream is on: the first one that is not done. Steps are
// handed out one at a time, in file order. Undefined once every step is done.
function currentStep(wf: Workflow, ws: Workstream): Step | undefined {
  return wf.steps.find((step) => stateOf(ws, step.id).status !== "done");
}

// --------------------------------------------------------------------- start
// Mint a workstream that follows `workflowRef` (a workflow name or an
// absolute path), or resume the one that exists. Either way it prints the
// current step, so an agent that lost its context can pick the work up here.

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
  let current: string[] = [];
  updateWorkstream(
    root,
    slug,
    (ws) => {
      // List every step in the state file, so it reads as a complete checklist.
      wf.steps.forEach((step) => stateOf(ws, step.id));
      current = describeCurrent(root, slug, wf, ws);
    },
    { workflow: ref, steps: {} },
  );
  return [`${resumed ? "resumed" : "minted"} workstream ${slug}`, `workflow: ${path}`, `state:    ${workstreamFile(root, slug)}`, "", ...current];
}

// What the agent should do now. `start` and `continue` print this while they
// hold the lock, with the state they are about to write, so the step they
// print is the current one when their change lands.
function describeCurrent(root: string, slug: string, wf: Workflow, ws: Workstream): string[] {
  const step = currentStep(wf, ws);
  if (!step) return ["workflow complete"];

  const state = stateOf(ws, step.id);
  const approve = `${FUSE_FLOW} continue ${slug} --owner-approved`;
  switch (state.status) {
    case "awaiting-owner":
      return [
        `step: ${step.id} awaits owner approval`,
        `ask the owner to: ${step.gates.filter((g) => g.kind === "owner-action").map((g) => g.description).join("; ") || "approve"}`,
        `artifacts: ${state.artifacts.join(", ") || "(no artifacts)"}`,
        `after the owner approves, run: ${approve} [--note "<what the owner said>"]`,
      ];
    case "blocked":
      return [
        `step: ${step.id} is blocked after ${state.fix_cycles} refused attempts`,
        ...state.history.slice(-3).map((line) => `  ${line}`),
        `ask the owner how to proceed; if the owner accepts the step as it is, run: ${approve} --note "<the owner's decision>"`,
      ];
    default: {
      const lines = [`step: ${step.id}${step.title ? ` (${step.title})` : ""}`];
      for (const skill of step.skills) {
        const path = findSkill(root, skill);
        lines.push(`read: ${path ?? `${skill}   (not found; set FUSE_SKILLS_DIR)`}`);
      }
      if (step.instruction) lines.push(`instruction: ${step.instruction.trim()}`);
      lines.push(`produce: ${step.produces.join(", ") || "(nothing declared)"}`);
      for (const g of step.gates) {
        if (g.kind === "agent") lines.push(`agent gate: before continuing, have an agent ${g.description}`);
        if (g.kind === "script") lines.push(`script gate: ${g.description}   (runs on continue; must exit 0)`);
        if (g.kind === "owner-action") lines.push(`owner gate: the owner must ${g.description}`);
      }
      lines.push(`gates: ${describeGates(step.gates)}`);
      lines.push(`then run: ${FUSE_FLOW} continue ${slug}`);
      return lines;
    }
  }
}

// ------------------------------------------------------------------ continue
// Move the workstream on from its current step, then print the new current
// step. What that means depends on the step's status:
//
//   pending         the agent finished the work. Accepted only when every
//                   artifact exists and the step's check command (if any)
//                   exits 0; a refusal costs one fix cycle, and after
//                   max_fix_cycles of them (the step's own value, else
//                   the workflow's) the step is blocked. A step with
//                   gate: owner goes to awaiting-owner instead of done.
//   awaiting-owner  needs --owner-approved: the owner has approved the step.
//   blocked         needs --owner-approved: the owner accepts the step as it is.

export interface Continue {
  ownerApproved: boolean;
  note?: string;
  extraArtifacts: string[];
}

export function continueWorkstream(root: string, slug: string, input: Continue): string[] {
  const initial = readWorkstream(root, slug);
  const wf = workflowOf(root, initial);
  const step = currentStep(wf, initial);
  if (!step) throw new FlowError("workflow complete; there is nothing to continue");

  if (stateOf(initial, step.id).status === "pending") {
    if (input.ownerApproved) {
      throw new FlowError(`step "${step.id}" is pending, not awaiting the owner; finish it and run continue without --owner-approved`);
    }
    return finishStep(root, slug, wf, step, input.extraArtifacts);
  }
  if (!input.ownerApproved) {
    const status = stateOf(initial, step.id).status;
    throw new FlowError(`step "${step.id}" is ${status}; only the owner can move it on, with continue --owner-approved`);
  }
  return approveStep(root, slug, wf, step, input.note);
}

function finishStep(root: string, slug: string, wf: Workflow, step: Step, extraArtifacts: string[]): string[] {
  const artifacts = [...new Set([...step.produces, ...extraArtifacts])];
  const missing = artifacts.filter((a) => !existsSync(resolve(root, a)));
  if (missing.length > 0) throw countRefusal(root, slug, wf, step, `missing artifact(s): ${missing.join(", ")}`);

  // The check runs without holding the state file's lock, so a long test run
  // does not stall fuse-flow commands for other workstreams.
  for (const gate of step.gates) {
    if (gate.kind !== "script") continue;
    const check = runCheck(root, gate.description, slug, step.id);
    if (check.exitCode !== 0) {
      const reason = `script failed (exit ${check.exitCode ?? "none, killed by a signal"}): ${gate.description}`;
      throw countRefusal(root, slug, wf, step, reason, check.output);
    }
  }

  const awaitsOwner = step.gates.some((g) => g.kind === "owner-action");
  let current: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const state = requirePending(wf, ws, step); // unchanged while the check ran?
    state.artifacts = artifacts;
    state.status = awaitsOwner ? "awaiting-owner" : "done";
    state.history.push(stamp(awaitsOwner ? "artifacts recorded; awaiting owner approval" : "done"));
    current = describeCurrent(root, slug, wf, ws);
  });
  return [
    `recorded ${step.id}: ${artifacts.join(", ") || "(no artifacts)"}`,
    awaitsOwner ? `${step.id} now awaits owner approval` : `${step.id} done`,
    "",
    ...current,
  ];
}

function approveStep(root: string, slug: string, wf: Workflow, step: Step, note?: string): string[] {
  let current: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const state = stateOf(ws, step.id);
    if (state.status !== "awaiting-owner" && state.status !== "blocked") {
      throw new FlowError(`step "${step.id}" is ${state.status} now; run continue again`);
    }
    state.status = "done";
    state.history.push(stamp(`owner approved${note ? `: ${note}` : ""}`));
    current = describeCurrent(root, slug, wf, ws);
  });
  return [`${step.id}: owner approved; step done`, "", ...current];
}

// The step must still be the pending current step when the state is written:
// another `continue` may have finished it while this one ran its check. That
// refusal costs no fix cycle.
function requirePending(wf: Workflow, ws: Workstream, step: Step) {
  const state = stateOf(ws, step.id);
  if (state.status !== "pending") throw new FlowError(`step "${step.id}" is ${state.status} now; run continue again`);
  return state;
}

// Record a refused attempt on the step, blocking it when that was the last
// fix cycle, and return the error that tells the caller why.
function countRefusal(root: string, slug: string, wf: Workflow, step: Step, reason: string, output = "") {
  const limit = step.max_fix_cycles ?? wf.max_fix_cycles;
  let fixCycles = 0;
  updateWorkstream(root, slug, (ws) => {
    const state = requirePending(wf, ws, step);
    state.fix_cycles += 1;
    state.history.push(stamp(`continue refused: ${reason}`));
    if (state.fix_cycles >= limit) state.status = "blocked";
    fixCycles = state.fix_cycles;
  });
  const blocked = fixCycles >= limit ? " (the step is now blocked)" : "";
  return new FlowError(
    [reason, output, `fix cycles used on ${step.id}: ${fixCycles} of ${limit}${blocked}`]
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

// -------------------------------------------------------------------- status

export function status(root: string, slug: string): string[] {
  const ws = readWorkstream(root, slug);
  const wf = workflowOf(root, ws);
  const width = Math.max(...wf.steps.map((s) => s.id.length));
  const current = currentStep(wf, ws);
  const rows = wf.steps.map((step) => {
    const state = stateOf(ws, step.id);
    const details = [state.fix_cycles > 0 ? `fix cycles ${state.fix_cycles}` : "", state.artifacts.join(", ")].filter(Boolean);
    const marker = step === current ? "> " : "  ";
    const columns = [step.id.padEnd(width), state.status.padEnd(14), `gates ${describeGates(step.gates).padEnd(6)}`];
    return `${marker}${[...columns, details.join("; ")].join("  ")}`.trimEnd();
  });
  const footer = current ? `current step: ${current.id}; ${FUSE_FLOW} start ${slug} prints what to do` : "workflow complete";
  return [`workstream ${slug} (${wf.name})`, ...rows, footer];
}
