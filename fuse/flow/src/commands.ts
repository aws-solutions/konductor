// SPDX-License-Identifier: Apache-2.0
// The fuse-flow commands. Each returns the lines to print, or throws a
// FlowError whose message says why the command was refused.
//
// A workstream is a state machine: the current step is the first step in file
// order that is not done, and `continue` is the one input that moves it on.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FlowError } from "./errors.ts";
import { findSkill, findWorkflow, isDirectory, workflowFilesBelow, workstreamFile } from "./project.ts";
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

// How the owner sends the work back from `step`, with the steps its gates
// suggest first. The owner usually names an artifact to rework, so the steps
// up to this one are listed with the artifacts they produce.
function sendBackLines(slug: string, wf: Workflow, step: Step): string[] {
  const steps = wf.steps.slice(0, wf.steps.indexOf(step) + 1).map((s) => (s.produces.length ? `${s.id}: ${s.produces.join(", ")}` : s.id));
  const routes = [...new Set(step.gates.flatMap((g) => g.route_back_to))];
  return [
    `    ${FUSE_FLOW} continue ${slug} --back-to <step> [--note "<the owner's decision>"]`,
    ...(routes.length ? [`    suggested by the step's gates: ${routes.join(", ")}`] : []),
    `    to rework an artifact, send the work back to the step that produces it: ${steps.join("; ")}`,
  ];
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
        `ask the owner to: ${step.gates.filter((g) => g.kind === "owner-action").map((g) => g.text).join("; ") || "approve"}`,
        `artifacts: ${state.artifacts.join(", ") || "(no artifacts)"}`,
        `after the owner approves, run: ${approve} [--note "<what the owner said>"]`,
        "if the owner rejects it instead, send the work back to a step:",
        ...sendBackLines(slug, wf, step),
      ];
    case "blocked": {
      const lines = [
        `step: ${step.id} is blocked`,
        ...state.history.slice(-3).map((line) => `  ${line}`),
        "ask the owner how to proceed, then run the command for the owner's decision:",
        `  accept the step as it is:     ${approve} --note "<the owner's decision>"`,
      ];
      if (step.gates.some((g) => g.kind === "agent")) {
        lines.push(`  grant more review rounds:     ${FUSE_FLOW} continue ${slug} --more-rounds <n> [--note "<the owner's decision>"]`);
      }
      lines.push("  send the work back to a step:", ...sendBackLines(slug, wf, step));
      return lines;
    }
    default: {
      const lines = [`step: ${step.id}${step.title ? ` (${step.title})` : ""}`];
      for (const skill of step.skills) {
        const path = findSkill(root, skill);
        lines.push(`read: ${path ?? `${skill}   (not found; set FUSE_SKILLS_DIR)`}`);
      }
      if (step.instruction) lines.push(`instruction: ${step.instruction.trim()}`);
      lines.push(`produce: ${step.produces.join(", ") || "(nothing declared)"}`);
      for (const g of step.gates) {
        if (g.kind === "agent") {
          const granted = state.rounds_granted ?? 0;
          const cap = granted ? `${g.max_rounds! + granted} (${g.max_rounds} plus ${granted} granted by the owner)` : `${g.max_rounds}`;
          lines.push(
            `agent gate: before continuing, have an agent ${g.text}. Consider each finding critically and ` +
              `classify it as fix required or false positive, with the reason; a finding the owner already ` +
              `accepted or deferred is not a required fix. Fix what is required and review again, until a round ` +
              `ends with no required fix. Every round that ends with a required fix counts, whatever the cause: ` +
              `you and the reviewer disagree, the reviewer finds new problems each round, or a fix introduced a ` +
              `regression. ` +
              `After ${cap} such rounds, do not start another; run: ${FUSE_FLOW} continue ${slug} --blocked ` +
              `"<what is still open, and why the review does not converge>"`,
          );
        }
        if (g.kind === "script") lines.push(`script gate: ${g.text}   (runs on continue; must exit 0)`);
        if (g.kind === "owner-action") lines.push(`owner gate: the owner must ${g.text}`);
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
//                   artifact exists and the step's script gates exit 0; a
//                   refusal is recorded in the step's history and costs
//                   nothing, because the agent can always fix the artifact.
//                   A step with an owner-action gate goes to awaiting-owner
//                   instead of done. With --blocked, the agent reports that
//                   it cannot finish the step, for example after max_rounds
//                   review rounds, and the step is blocked.
//   awaiting-owner  needs the owner's decision: --owner-approved approves the
//                   step, and --back-to <step> rejects it and makes that step
//                   (it or an earlier one) and every step after it pending.
//   blocked         needs the owner's decision: --owner-approved accepts the
//                   step as it is, --more-rounds <n> grants n more review
//                   rounds and makes the step pending again, and --back-to
//                   <step> sends the work back as above.

export interface Continue {
  ownerApproved: boolean;
  note?: string;
  blocked?: string;
  moreRounds?: number;
  backTo?: string;
  extraArtifacts: string[];
}

export function continueWorkstream(root: string, slug: string, input: Continue): string[] {
  const initial = readWorkstream(root, slug);
  const wf = workflowOf(root, initial);
  const step = currentStep(wf, initial);
  if (!step) throw new FlowError("workflow complete; there is nothing to continue");

  const status = stateOf(initial, step.id).status;
  if (status === "pending") {
    if (input.ownerApproved) {
      throw new FlowError(`step "${step.id}" is pending, not awaiting the owner; finish it and run continue without --owner-approved`);
    }
    if (input.moreRounds !== undefined) throw new FlowError(`step "${step.id}" is pending, not blocked; --more-rounds answers a blocked step`);
    if (input.backTo !== undefined) {
      throw new FlowError(`step "${step.id}" is pending; --back-to answers a step that awaits the owner or is blocked`);
    }
    if (input.blocked !== undefined) return blockStep(root, slug, wf, step, input.blocked);
    return finishStep(root, slug, wf, step, input.extraArtifacts);
  }
  if (input.moreRounds !== undefined) {
    if (status !== "blocked") throw new FlowError(`step "${step.id}" is ${status}, not blocked; --more-rounds answers a blocked step`);
    return grantRounds(root, slug, wf, step, input.moreRounds, input.note);
  }
  if (input.backTo !== undefined) return sendBack(root, slug, wf, step, input.backTo, input.note);
  if (!input.ownerApproved) {
    throw new FlowError(`step "${step.id}" is ${status}; only the owner can move it on, with continue --owner-approved`);
  }
  return approveStep(root, slug, wf, step, input.note);
}

function finishStep(root: string, slug: string, wf: Workflow, step: Step, extraArtifacts: string[]): string[] {
  const artifacts = [...new Set([...step.produces, ...extraArtifacts])];
  const missing = artifacts.filter((a) => !existsSync(resolve(root, a)));
  if (missing.length > 0) {
    const expected = missing.map((a) => (resolve(root, a) === a ? a : `${a} (${resolve(root, a)})`));
    throw refuse(root, slug, wf, step, `missing artifact(s): ${expected.join(", ")}`);
  }

  // The check runs without holding the state file's lock, so a long test run
  // does not stall fuse-flow commands for other workstreams.
  for (const gate of step.gates) {
    if (gate.kind !== "script") continue;
    const check = runCheck(root, gate.text, slug, step.id);
    if (check.exitCode !== 0) {
      const reason = `script failed (exit ${check.exitCode ?? "none, killed by a signal"}): ${gate.text}`;
      throw refuse(root, slug, wf, step, reason, check.output);
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

function blockStep(root: string, slug: string, wf: Workflow, step: Step, reason: string): string[] {
  let current: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const state = requirePending(wf, ws, step);
    state.status = "blocked";
    state.history.push(stamp(`blocked by the agent: ${reason}`));
    current = describeCurrent(root, slug, wf, ws);
  });
  return [`${step.id} blocked: ${reason}`, "", ...current];
}

// The owner gives the agent gates of a blocked step `n` more review rounds.
function grantRounds(root: string, slug: string, wf: Workflow, step: Step, n: number, note?: string): string[] {
  if (!step.gates.some((g) => g.kind === "agent")) {
    throw new FlowError(`step "${step.id}" has no agent gate, so there are no review rounds to grant`);
  }
  let current: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const state = requireBlocked(ws, step);
    state.status = "pending";
    state.rounds_granted = (state.rounds_granted ?? 0) + n;
    state.history.push(stamp(`owner granted ${n} more review round${n === 1 ? "" : "s"}${note ? `: ${note}` : ""}`));
    current = describeCurrent(root, slug, wf, ws);
  });
  return [`${step.id}: owner granted ${n} more review round${n === 1 ? "" : "s"}; step pending again`, "", ...current];
}

// The owner sends the work back from a step that awaits the owner or is
// blocked to `target`, the step
// itself or an earlier one: that step and every step after it are pending
// again, with no recorded artifacts and no granted rounds. The files the
// steps wrote stay where they are.
function sendBack(root: string, slug: string, wf: Workflow, step: Step, target: string, note?: string): string[] {
  const from = wf.steps.findIndex((s) => s.id === target);
  const at = wf.steps.indexOf(step);
  if (from < 0) throw new FlowError(`no step "${target}" in workflow ${wf.name}`);
  if (from > at) throw new FlowError(`step "${target}" comes after "${step.id}"; --back-to names "${step.id}" or a step before it`);
  let current: string[] = [];
  updateWorkstream(root, slug, (ws) => {
    const status = stateOf(ws, step.id).status;
    if (status !== "blocked" && status !== "awaiting-owner") {
      throw new FlowError(`step "${step.id}" is ${status} now; run continue again`);
    }
    for (const s of wf.steps.slice(from)) {
      const state = stateOf(ws, s.id);
      if (state.status === "pending" && s !== step) continue;
      state.status = "pending";
      state.artifacts = [];
      delete state.rounds_granted;
      state.history.push(stamp(`owner sent the work back from ${step.id} to ${target}${note ? `: ${note}` : ""}`));
    }
    current = describeCurrent(root, slug, wf, ws);
  });
  return [`${step.id}: owner sent the work back to ${target}`, "", ...current];
}

// The step must still be blocked when the owner's answer is written.
function requireBlocked(ws: Workstream, step: Step) {
  const state = stateOf(ws, step.id);
  if (state.status !== "blocked") throw new FlowError(`step "${step.id}" is ${state.status} now; run continue again`);
  return state;
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
// another `continue` may have finished it while this one ran its check.
function requirePending(wf: Workflow, ws: Workstream, step: Step) {
  const state = stateOf(ws, step.id);
  if (state.status !== "pending") throw new FlowError(`step "${step.id}" is ${state.status} now; run continue again`);
  return state;
}

// Record a refused attempt in the step's history, and return the error that
// tells the caller why.
function refuse(root: string, slug: string, wf: Workflow, step: Step, reason: string, output = "") {
  updateWorkstream(root, slug, (ws) => {
    requirePending(wf, ws, step).history.push(stamp(`continue refused: ${reason}`));
  });
  return new FlowError([reason, output].filter(Boolean).join("\n"));
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
    const details = [state.artifacts.join(", ")].filter(Boolean);
    const marker = step === current ? "> " : "  ";
    const columns = [step.id.padEnd(width), state.status.padEnd(14), `gates ${describeGates(step.gates).padEnd(6)}`];
    return `${marker}${[...columns, details.join("; ")].join("  ")}`.trimEnd();
  });
  const footer = current ? `current step: ${current.id}; ${FUSE_FLOW} start ${slug} prints what to do` : "workflow complete";
  return [`workstream ${slug} (${wf.name})`, ...rows, footer];
}

// ------------------------------------------------------------------ validate
// Check workflow files without starting a workstream. Each reference is a
// workflow name, a file, or a directory, which stands for every .yml and .yaml
// file below it, in nested folders too. Every file is checked and reported;
// the command is refused when any of them is invalid.

export function validate(root: string, refs: string[]): string[] {
  const lines: string[] = [];
  let checked = 0;
  let invalid = 0;
  const seen = new Set<string>();
  for (const ref of refs) {
    let files: string[];
    try {
      files = isDirectory(ref) ? workflowFilesBelow(root, ref) : [findWorkflow(root, ref)];
      if (files.length === 0) throw new FlowError(`no .yml or .yaml files in ${ref} or below it`);
    } catch (e) {
      if (!(e instanceof FlowError)) throw e;
      checked += 1;
      invalid += 1;
      lines.push(`invalid: ${e.message}`);
      continue;
    }
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      checked += 1;
      try {
        loadWorkflow(file);
        lines.push(`valid:   ${file}`);
      } catch (e) {
        if (!(e instanceof FlowError)) throw e;
        invalid += 1;
        lines.push(`invalid: ${e.message}`);
      }
    }
  }
  if (invalid > 0) throw new FlowError([`${invalid} of ${checked} workflows are invalid`, ...lines].join("\n"));
  return [...lines, `${checked} workflow${checked === 1 ? "" : "s"} valid`];
}
