// SPDX-License-Identifier: Apache-2.0
// The fuse-flow commands. Each returns the lines to print, or throws a
// FlowError whose message says why the command was refused.
//
// A workstream is a state machine. The current step is the first step in file
// order that is neither COMPLETED nor SKIPPED. Every command ends by handing
// out the current step, if it is PENDING, and printing what to do next: the
// step block when it is the agent's turn (decision 26), the hand-over block
// when it is the owner's (decision 22).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { FlowError } from "./errors.ts";
import { EVENT, SKIP_REASON, stamp } from "./history.ts";
import {
  artifactPath,
  checkBinding,
  display,
  libraryEntry,
  libraryFolders,
  loadProject,
  maxRounds,
  type Project,
  reviewer,
  reviewGuide,
} from "./policy.ts";
import { findWorkflow, isDirectory, workflowFilesBelow, workstreamFile } from "./project.ts";
import { type Artifact, type Condition, describeGates, type Gate, loadWorkflow, type Step, type Workflow } from "./workflow.ts";
import {
  readWorkstream,
  type StepState,
  type StepStatus,
  stateOf,
  updateWorkstream,
  type Workstream,
  workstreamExists,
} from "./workstream.ts";

// How the follow-up commands fuse-flow prints start. The fuse-flow script
// sets FUSE_FLOW_COMMAND to its own absolute path, so a printed command works
// without fuse-flow being on PATH.
const FUSE_FLOW = shellQuote(process.env.FUSE_FLOW_COMMAND || "fuse-flow");

// A path that the shell reads as one word, even with spaces or quotes in it.
function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

const finished = (status: StepStatus) => status === "COMPLETED" || status === "SKIPPED";

// Everything a command needs to know about one workstream. The workflow is
// read fresh on every command, so an edit to the workflow file takes effect
// straight away.
interface Ctx {
  root: string;
  slug: string;
  wf: Workflow;
  p: Project;
}

function context(root: string, slug: string, ws: Workstream): Ctx {
  return { root, slug, wf: loadWorkflow(findWorkflow(root, ws.workflow)), p: loadProject(root) };
}

function currentStep(wf: Workflow, ws: Workstream): Step | undefined {
  return wf.steps.find((step) => !finished(stateOf(ws, step.id).status));
}

const position = (c: Ctx, step: Step) => `${c.wf.steps.indexOf(step) + 1} of ${c.wf.steps.length}`;

// The gates in the order they run (decision 27): checks, then agent reviews,
// then the owner. Within a kind, the order the workflow lists them in.
function gatesInOrder(step: Step): Gate[] {
  const rank = (g: Gate) => (g.kind === "check" || g.kind === "script" ? 0 : g.kind === "agent" ? 1 : 2);
  return [...step.gates].sort((a, b) => rank(a) - rank(b));
}

const ownerGates = (step: Step) => step.gates.filter((g) => g.kind === "owner-action");
const routesBack = (step: Step) => [...new Set(step.gates.flatMap((g) => g.route_back_to))];

interface Placed {
  artifact: Artifact;
  path: string; // relative to the repository root, {slug} replaced
}

const place = (c: Ctx, artifacts: Artifact[]): Placed[] => artifacts.map((artifact) => ({ artifact, path: artifactPath(c.p, artifact, c.slug) }));
const onDisk = (c: Ctx, path: string) => existsSync(resolve(c.root, path));

// Whether `file` lies at or below `path`. Both are as display() shows them:
// relative to the repository root when inside it, absolute when outside, so
// a file outside the repository is inside no artifact.
function contains(path: string, file: string): boolean {
  if (isAbsolute(file) || file === ".." || file.startsWith("../")) return false;
  const dir = path.replace(/\/+$/, "").replace(/^\.\/+/, "");
  if (dir === "" || dir === ".") return true;
  return file === dir || file.startsWith(`${dir}/`);
}

// Every path this workstream recorded, in any step.
function recordedPaths(ws: Workstream): Set<string> {
  return new Set(Object.values(ws.steps).flatMap((s) => s.artifacts.map((a) => a.path)));
}

// ------------------------------------------------------------------ commands

// How a mechanical gate or condition runs in this project: its command, or why
// there is none.
type Mechanical =
  | { kind: "run"; command: string; label: string }
  | { kind: "none"; label: string; file: string }
  | { kind: "unbound"; label: string; check: string };

function mechanical(c: Ctx, g: Gate | Condition): Mechanical {
  if (g.kind === "script") return { kind: "run", command: g.text, label: `script \`${g.text}\`` };
  const binding = checkBinding(c.p, g.text);
  const label = `check ${g.text}`;
  if (!binding) return { kind: "unbound", label, check: g.text };
  if (binding.command === "none") return { kind: "none", label, file: display(c.p, binding.file) };
  return { kind: "run", command: binding.command, label: `${label} (\`${binding.command}\`)` };
}

function bindInstruction(c: Ctx, check: string): string {
  const base =
    `This project has no command for the ${check} check yet. Find it in the project (package.json, a Makefile, ` +
    `Cargo.toml and so on), confirm it with the owner, and record it in .konductor/policy-overrides.yml as ` +
    `\`checks: { ${check}: <command> }\`.`;
  return check === "default"
    ? `${base} If the project has no check command for agents, suggest that the owner add one, and meanwhile bind ` +
        "the closest existing command, with the owner's confirmation."
    : base;
}

// Runs from the repository root with the caller's environment, like a
// Makefile target. Keeps only the end of the output: enough to see why it
// failed without flooding the agent's context.
function runCommand(c: Ctx, command: string, stepId: string) {
  const proc = spawnSync("sh", ["-c", command], {
    cwd: c.root,
    env: { ...process.env, FUSE_FLOW_SLUG: c.slug, FUSE_FLOW_STEP: stepId },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024, // a test suite can print a lot; keep it all, then trim
  });
  if (proc.error) throw proc.error;
  const text = (proc.stdout + proc.stderr).trim();
  return { exitCode: proc.status, output: text.split("\n").slice(-20).join("\n") };
}

// ------------------------------------------------------------------ hand-out
// Hand out the current step if it is PENDING: run a script or check condition
// and skip the step when it says so, otherwise mark it IN_PROGRESS and note
// which of its produces paths already exist. Repeats until the current step is
// handed out, waits for someone, or the workflow is complete. A condition runs
// without holding the state file's lock.

function handOut(c: Ctx): void {
  for (;;) {
    const ws = readWorkstream(c.root, c.slug);
    const step = currentStep(c.wf, ws);
    if (!step || stateOf(ws, step.id).status !== "PENDING") return;

    let skip: string | undefined;
    let note = EVENT.handedOut();
    const cond = step.condition;
    if (cond && (cond.kind === "script" || cond.kind === "check")) {
      const m = mechanical(c, cond);
      if (m.kind === "unbound") return; // stays PENDING; the output says how to bind it
      if (m.kind === "run") {
        const r = runCommand(c, m.command, step.id);
        if (r.exitCode === 0) note = EVENT.handedOut(`condition \`${m.command}\` exited 0`);
        else skip = `condition \`${m.command}\` exited ${r.exitCode ?? "without a code, killed by a signal"}`;
      } else {
        note = EVENT.handedOut(`condition ${m.label} is not configured in this project`);
      }
    }

    let moved = false;
    updateWorkstream(c.root, c.slug, (ws2) => {
      const state = stateOf(ws2, step.id);
      if (currentStep(c.wf, ws2) !== step || state.status !== "PENDING") return; // another command got here first
      moved = true;
      if (skip) {
        state.status = "SKIPPED";
        state.skip_reason = skip;
        state.history.push(stamp(EVENT.skipped(skip)));
        return;
      }
      state.status = "IN_PROGRESS";
      const recorded = recordedPaths(ws2);
      const existed = place(c, step.produces)
        .map((a) => a.path)
        .filter((path) => onDisk(c, path) && !recorded.has(path));
      if (existed.length) state.existed = existed;
      else delete state.existed;
      state.history.push(stamp(note));
    });
    if (!moved) continue;
    if (!skip) return;
  }
}

// ------------------------------------------------------------------ output

function present(c: Ctx): string[] {
  handOut(c);
  const ws = readWorkstream(c.root, c.slug);
  const step = currentStep(c.wf, ws);
  if (!step) return handOver(c, ws, undefined);
  const state = stateOf(ws, step.id);
  switch (state.status) {
    case "PENDING": {
      const m = mechanical(c, step.condition!) as Extract<Mechanical, { kind: "unbound" }>;
      return [
        `STEP ${step.id} (${position(c, step)}) cannot be handed out yet: its condition names the ${m.check} check.`,
        `${bindInstruction(c, m.check)} Then run \`${FUSE_FLOW} start ${c.slug}\`.`,
      ];
    }
    case "IN_PROGRESS":
      return stepBlock(c, ws, step, state);
    default:
      return handOver(c, ws, step);
  }
}

// What the agent does now (decision 26).
function stepBlock(c: Ctx, ws: Workstream, step: Step, state: StepState): string[] {
  const lines = [`STEP ${step.id} (${position(c, step)}): ${step.instruction.replace(/\s+/g, " ").trim()}`];
  const ff = `${FUSE_FLOW} continue ${c.slug}`;

  const cond = step.condition;
  if (cond?.kind === "agent") {
    lines.push(`CONDITION: Do this step only if ${cond.text}. Otherwise run \`${ff} --skip "<why it does not apply>"\`.`);
  } else if (cond?.kind === "owner-action") {
    lines.push(
      `CONDITION: Before you start, ask the owner to ${cond.text}, and end your message with the hand-over block, ` +
        `STATUS needs input. If the owner decides to skip the step, run \`${ff} --skip "<the owner's reason>"\`; ` +
        "otherwise do the step.",
    );
  } else if (cond) {
    const ran = state.history.findLast((h) => h.includes("handed out"));
    if (ran?.includes("condition")) lines.push(`CONDITION: ${ran.slice(ran.indexOf("condition"))}, so the step runs.`);
  }

  for (const id of step.consumes) {
    const source = [...c.wf.steps.slice(0, c.wf.steps.indexOf(step))]
      .reverse()
      .find((s) => [...s.produces, ...s.optional_produces, ...s.updates].some((a) => a.artifact === id))!;
    const artifact = [...source.produces, ...source.optional_produces, ...source.updates].find((a) => a.artifact === id)!;
    const path = artifactPath(c.p, artifact, c.slug);
    lines.push(
      onDisk(c, path)
        ? `READ ${path} (from step ${source.id}).`
        : `READ ${path} (from step ${source.id}). It does not exist, for example because earlier steps were skipped. ` +
            "Restore what this step needs in the way that serves the owner, such as copying or extracting it from " +
            "related work, or writing a placeholder that explains the status, and report what you did in the " +
            "hand-over block.",
    );
  }

  const existed = new Set(state.existed ?? []);
  const artifactLine = (label: string, a: Placed, missingNote?: string) => {
    let line = `${label} ${a.path} (${a.artifact.artifact}).`;
    const entry = libraryEntry(c.p, a.artifact.artifact);
    if (entry?.guide) {
      line += ` Follow the process in ${display(c.p, entry.guide)}`;
      line += entry.template ? ` and use the structure of ${display(c.p, entry.template)}.` : ".";
    } else if (entry?.guideMissing) {
      line +=
        ` Its guide is missing (${display(c.p, entry.guideMissing)} cannot be read); ask the owner whether to continue ` +
        "without it, install it and run this command again, or use another workflow.";
      if (entry.template) line += ` Use the structure of ${display(c.p, entry.template)}.`;
    } else if (entry?.template) {
      line += ` Use the structure of ${display(c.p, entry.template)}.`;
    }
    if (missingNote) line += ` ${missingNote}`;
    return line;
  };
  for (const a of place(c, step.produces)) {
    lines.push(
      artifactLine(
        "PRODUCE",
        a,
        existed.has(a.path)
          ? `${a.path} already existed when the step was handed out, and this workstream did not write it. Do what ` +
              "the instruction or the guide says about it; if they say nothing, judge whether to ask the owner to " +
              "update it, replace it, or use a different path."
          : undefined,
      ),
    );
  }
  for (const a of place(c, step.optional_produces)) lines.push(artifactLine("PRODUCE (optional)", a));
  for (const a of place(c, step.updates)) {
    lines.push(
      artifactLine("UPDATE", a, onDisk(c, a.path) ? undefined : `${a.path} does not exist yet; create it and report it with --updated.`),
    );
  }

  lines.push("WHEN THE WORK IS DONE:");
  let n = 0;
  const reviewed = place(c, [...step.produces, ...step.optional_produces, ...step.updates]);
  for (const g of gatesInOrder(step)) {
    if (g.kind === "check" || g.kind === "script") {
      const m = mechanical(c, g);
      const again = "fuse-flow runs it again on continue and refuses the step while it fails.";
      if (m.kind === "run") {
        const what = g.kind === "check" ? `, the project's ${g.text} check (bound in ${display(c.p, checkBinding(c.p, g.text)!.file)})` : "";
        lines.push(`  ${++n}. Run \`${m.command}\`${what}. Fix the work, or the check if the check is wrong, until it passes. ${again}`);
      } else if (m.kind === "none") {
        lines.push(`  ${++n}. The ${g.text} check is not configured in this project (bound to none in ${m.file}); there is nothing to run.`);
      } else {
        lines.push(`  ${++n}. ${bindInstruction(c, m.check)} Then run it and fix the work until it passes. ${again}`);
      }
    } else if (g.kind === "agent") {
      lines.push(`  ${++n}. ${reviewText(c, g, step, state, reviewed)}`);
    }
  }

  let last = `  ${++n}. Run \`${ff}\``;
  const updates = step.updates.map((a) => a.artifact);
  const produces = step.produces.map((a) => a.artifact);
  const parts: string[] = [];
  if (updates.length) {
    const which = updates.length === 1 ? `if you left ${updates[0]} as it was` : `for each of ${updates.join(", ")} that you left as it was`;
    parts.push(`with --updated <file> for each file you revised (repeat it), and --unchanged <artifact> "<reason>" ${which}`);
  }
  if (produces.length) {
    const which = produces.length === 1 ? `if you rightly did not write ${produces[0]}` : `for each of ${produces.join(", ")} that you rightly did not write`;
    parts.push(`with --not-produced <artifact> "<reason>" only ${which}`);
  }
  if (parts.length) last += `, ${parts.join("; and ")}`;
  last += ".";
  const owner = ownerGates(step);
  if (owner.length) {
    last += ` The step then waits for the owner to ${owner.map((g) => g.text).join(", and to ")}.`;
    const routes = routesBack(step);
    if (routes.length) last += ` If the owner rejects it, suggest sending the work back to ${routes.join(" or ")}.`;
  }
  lines.push(last);
  return lines;
}

function capOf(c: Ctx, g: Gate, state: StepState): string {
  const cap = maxRounds(c.p, g);
  const granted = state.rounds_granted ?? 0;
  return granted ? `${cap + granted} (${cap} plus ${granted} granted by the owner)` : `${cap}`;
}

function reviewText(c: Ctx, g: Gate, step: Step, state: StepState, reviewed: Placed[]): string {
  let text = `Have an independent agent ${g.text.replace(/\.$/, "")}.`;
  const guided: string[] = [];
  const parts: string[] = [];
  for (const a of reviewed) {
    const guide = reviewGuide(c.p, g, a.artifact.artifact);
    if (guide) {
      guided.push(guide);
      parts.push(`${a.path} against ${display(c.p, guide)}`);
    } else {
      const own = libraryEntry(c.p, a.artifact.artifact)?.guide;
      parts.push(own ? `${a.path}, with its guide ${display(c.p, own)} as the definition of a good artifact` : a.path);
    }
  }
  if (reviewed.length === 0) {
    const guide = reviewGuide(c.p, g, undefined);
    if (guide) {
      guided.push(guide);
      text += ` Follow the review guide ${display(c.p, guide)}.`;
    }
  } else {
    text += ` It reviews ${parts.join("; ")}.`;
  }
  const who = reviewer(c.p);
  if (who) text += ` The reviewer: ${who}.`;
  text +=
    " Classify each finding as fix required or false positive, with the reason; a finding the owner already " +
    "accepted or deferred is not a required fix. Fix what is required and review again, until a round ends with " +
    "no required fix.";
  if (guided.length) text += " The review guide decides what counts as a required fix and when a round passes.";
  text +=
    " Every round that ends with a required fix counts, whatever the cause. After " +
    `${capOf(c, g, state)} such rounds, do not start another; run \`${FUSE_FLOW} continue ${c.slug} --blocked ` +
    `"<what is still open, and why the review does not converge>"\`.`;
  void step;
  return text;
}

// The PRODUCED line: the files the step created or changed, and the reasons
// for what it left out (decisions 22, 43 and 45).
function producedLine(c: Ctx, step: Step, state: StepState): string {
  const existed = new Set(state.existed ?? []);
  const files: string[] = [];
  const updatesPaths = place(c, step.updates).map((a) => a.path);
  const updatesIds = new Set(step.updates.map((a) => a.artifact));
  for (const a of state.artifacts) {
    if (a.artifact && updatesIds.has(a.artifact)) continue; // listed by file below
    files.push(`${a.path} (${existed.has(a.path) ? "updated" : "new"})`);
  }
  for (const f of state.updated ?? []) {
    files.push(updatesPaths.some((p) => contains(p, f)) ? `${f} (updated)` : `${f} (updated, outside the declared paths)`);
  }
  const parts: string[] = [];
  if (files.length >= 5) {
    const dirs = files.map((f) => dirname(f.split(" (")[0]));
    let common = dirs[0];
    while (common !== "." && !dirs.every((d) => d === common || d.startsWith(`${common}/`))) common = dirname(common);
    parts.push(`${files.length} files${common === "." ? "" : ` under ${common}/`}; summarize them, for example "12 files under src/checkout/, with their tests"`);
  } else {
    parts.push(...files);
  }
  for (const [id, why] of Object.entries(state.not_produced ?? {})) parts.push(`${id} not produced (${why})`);
  for (const [id, why] of Object.entries(state.unchanged ?? {})) parts.push(`${id} unchanged (${why})`);
  return `PRODUCED: ${parts.join("; ") || "none"}`;
}

function verificationLine(c: Ctx, step: Step, state: StepState): string {
  const mechanicalGates = gatesInOrder(step).filter((g) => g.kind === "check" || g.kind === "script");
  const parts = state.verification ? [...state.verification] : mechanicalGates.map((g) => `${mechanical(c, g).label}: not run`);
  for (const g of gatesInOrder(step)) {
    if (g.kind === "agent") parts.push(`review (${g.text}): <rounds used> of ${capOf(c, g, state)} rounds, <any required fix still open>`);
  }
  return `VERIFICATION: ${parts.join("; ") || "none"}`;
}

function stepsWithArtifacts(c: Ctx, step: Step): string {
  return c.wf.steps
    .slice(0, c.wf.steps.indexOf(step) + 1)
    .map((s) => {
      const paths = place(c, [...s.produces, ...s.updates]).map((a) => a.path);
      return paths.length ? `${s.id} (${paths.join(", ")})` : s.id;
    })
    .join(", ");
}

// When it is the owner's turn: the hand-over block, pre-filled (decision 22).
function handOver(c: Ctx, ws: Workstream, step: Step | undefined): string[] {
  const skips = c.wf.steps
    .map((s) => ({ s, state: stateOf(ws, s.id) }))
    .filter(({ state }) => state.status === "SKIPPED")
    .map(({ s, state }) => `${s.id} (${state.skip_reason ?? "no reason recorded"})`);
  const skipped = skips.length ? ` Skipped steps: ${skips.join("; ")}.` : "";
  const intro =
    "OWNER'S TURN: end your message with this hand-over block. Replace each <...> part, keep the lines in this " +
    "order, and give the owner's options with your recommendation first, with its reason.";

  if (!step) {
    const done = c.wf.steps.filter((s) => stateOf(ws, s.id).status === "COMPLETED");
    const produced = done.map((s) => `${s.id}: ${producedLine(c, s, stateOf(ws, s.id)).replace(/^PRODUCED: /, "")}`).filter((l) => !l.endsWith(": none"));
    const verified = done.flatMap((s) => (stateOf(ws, s.id).verification ?? []).map((v) => `${s.id}: ${v}`));
    const reviews = done.filter((s) => s.gates.some((g) => g.kind === "agent")).map((s) => `${s.id}: <review rounds used>`);
    return [
      intro,
      "",
      `SUMMARY: <the work, in a sentence>. Workstream ${c.slug}, all ${c.wf.steps.length} steps of ${c.wf.name}.${skipped}`,
      "STATUS: workflow complete",
      `PRODUCED: ${produced.join("; ") || "none"}`,
      `VERIFICATION: ${[...verified, ...reviews].join("; ") || "none"}`,
      "NEXT STEP: <what the owner may want next, for example reviewing or landing the work>",
    ];
  }

  const state = stateOf(ws, step.id);
  const ff = `${FUSE_FLOW} continue ${c.slug}`;
  const routes = routesBack(step);
  const back =
    `Send the work back: run \`${ff} --back-to <step> --note "<the owner's decision>"\`` +
    (routes.length ? `; the step's gates suggest ${routes.join(" or ")}` : "") +
    `. To rework an artifact, name the step that produces it: ${stepsWithArtifacts(c, step)}.`;
  const lines = [
    intro,
    "",
    `SUMMARY: <the task you worked on, in a sentence>. Workstream ${c.slug}, step ${step.id}, ${position(c, step)}.${skipped}`,
  ];
  if (state.status === "AWAITING_OWNER") {
    const asks = ownerGates(step).map((g) => g.text).join(", and ");
    lines.push(
      `STATUS: awaiting owner action. The owner is asked to ${asks}.`,
      producedLine(c, step, state),
      verificationLine(c, step, state),
      "NEXT STEP:",
      `  - The owner does what the step asks (${asks}): run \`${ff} --owner-approved --note "<what the owner said>"\`.`,
      `  - ${back}`,
    );
  } else {
    const why = state.history.findLast((h) => h.includes("blocked"))?.replace(/^\S+ /, "") ?? "blocked";
    lines.push(
      `STATUS: blocked. ${why}`,
      producedLine(c, step, state),
      verificationLine(c, step, state),
      "NEXT STEP:",
      `  - Accept the step as it is: run \`${ff} --owner-approved --note "<the owner's decision>"\`.`,
    );
    if (step.gates.some((g) => g.kind === "agent")) {
      lines.push(`  - Grant more review rounds: run \`${ff} --more-rounds <n> --note "<the owner's decision>"\`.`);
    }
    lines.push(`  - ${back}`);
  }
  return lines;
}

// --------------------------------------------------------------------- start
// Mint a workstream that follows `workflowRef` (a workflow name or an
// absolute path), or resume the one that exists. Either way it prints the
// current step, so an agent that lost its context can pick the work up here.
// `from` starts a new workstream at a later step, as the owner's decision.

export function start(root: string, slug: string, workflowRef?: string, from?: string): string[] {
  const resumed = workstreamExists(root, slug);
  let ref = workflowRef;
  if (resumed) {
    const recorded = readWorkstream(root, slug).workflow;
    if (ref !== undefined && ref !== recorded) {
      throw new FlowError(`workstream ${slug} follows workflow ${recorded}, not ${ref}`);
    }
    if (from !== undefined) throw new FlowError(`workstream ${slug} exists; --from starts a new one. To jump forward, use continue --forward-to`);
    ref = recorded;
  } else if (ref === undefined) {
    throw new FlowError(`a new workstream needs --workflow <name or path>, for example --workflow _k-full-sdlc`);
  }
  const path = findWorkflow(root, ref);
  const wf = loadWorkflow(path);
  const fromIndex = from === undefined ? 0 : wf.steps.findIndex((s) => s.id === from);
  if (fromIndex < 0) throw new FlowError(`no step "${from}" in workflow ${wf.name}`);
  updateWorkstream(
    root,
    slug,
    (ws) => {
      // List every step in the state file, so it reads as a complete checklist.
      wf.steps.forEach((step, i) => {
        const state = stateOf(ws, step.id);
        if (!resumed && i < fromIndex) {
          state.status = "SKIPPED";
          const reason = SKIP_REASON.startedAt(from ?? step.id);
          state.skip_reason = reason;
          state.history.push(stamp(EVENT.skipped(reason)));
        }
      });
    },
    { workflow: ref, steps: {} },
  );
  const c: Ctx = { root, slug, wf, p: loadProject(root) };
  return [`${resumed ? "resumed" : "minted"} workstream ${slug}`, `workflow: ${path}`, `state:    ${workstreamFile(root, slug)}`, "", ...present(c)];
}

// ------------------------------------------------------------------ continue

export interface Continue {
  ownerApproved: boolean;
  note?: string;
  blocked?: string;
  skip?: string;
  moreRounds?: number;
  backTo?: string;
  forwardTo?: string;
  updated: string[]; // absolute paths
  unchanged: Record<string, string>;
  notProduced: Record<string, string>;
}

export function continueWorkstream(root: string, slug: string, input: Continue): string[] {
  const initial = readWorkstream(root, slug);
  const c = context(root, slug, initial);
  handOut(c);
  const ws = readWorkstream(root, slug);
  const step = currentStep(c.wf, ws);
  if (!step) throw new FlowError("workflow complete; there is nothing to continue");
  const status = stateOf(ws, step.id).status;

  if (input.forwardTo !== undefined) return forwardTo(c, step, input.forwardTo, input.note);
  if (input.skip !== undefined) return skipStep(c, step, input.skip);
  if (input.moreRounds !== undefined) return grantRounds(c, step, input.moreRounds, input.note);
  if (input.backTo !== undefined) return sendBack(c, step, input.backTo, input.note);
  if (input.ownerApproved) return approveStep(c, step, input.note);

  if (status === "AWAITING_OWNER" || status === "BLOCKED") {
    throw new FlowError(
      `step "${step.id}" is ${status}; only the owner can move it on, with --owner-approved, --back-to` +
        (status === "BLOCKED" ? " or --more-rounds" : ""),
    );
  }
  if (status === "PENDING") throw new FlowError(present(c).join("\n"));
  if (input.blocked !== undefined) return blockStep(c, step, input.blocked);
  return finishStep(c, step, input);
}

// The step must still be the current step, in one of `allowed`, when the
// state is written: another command may have moved it while this one ran.
function expectState(c: Ctx, ws: Workstream, step: Step, allowed: StepStatus[]): StepState {
  const state = stateOf(ws, step.id);
  if (currentStep(c.wf, ws) !== step || !allowed.includes(state.status)) {
    throw new FlowError(`step "${step.id}" is ${state.status} now; run the command again`);
  }
  return state;
}

function refuse(c: Ctx, step: Step, reason: string, output = "", verification?: string[]): FlowError {
  updateWorkstream(c.root, c.slug, (ws) => {
    const state = expectState(c, ws, step, ["IN_PROGRESS"]);
    state.history.push(stamp(EVENT.refused(reason)));
    if (verification) state.verification = verification;
  });
  const ws = readWorkstream(c.root, c.slug);
  return new FlowError([reason, ...(output ? [output] : []), "", ...stepBlock(c, ws, step, stateOf(ws, step.id))].join("\n"));
}

// A path with "./" and trailing slashes removed, "." for the repository root.
const tidy = (path: string) => path.replace(/^(\.\/+)+/, "").replace(/\/+$/, "") || ".";

// Key the reasons given with `--<flag> <artifact> <reason>` by artifact id. The
// agent may name an artifact by its id or by its path as the step block shows
// it; an id wins when a name is both. A path that more than one of the
// artifacts uses is refused, since it does not say which one is meant.
function byArtifactId(c: Ctx, flag: string, verb: string, artifacts: Artifact[], given: Record<string, string>): Record<string, string> {
  const placed = place(c, artifacts);
  const known = placed.map((a) => `${a.artifact.artifact} (${a.path})`).join(", ") || `it ${verb} none`;
  const out: Record<string, string> = {};
  for (const [name, why] of Object.entries(given)) {
    let id = placed.find((a) => a.artifact.artifact === name)?.artifact.artifact;
    if (id === undefined) {
      const rel = relative(c.p.root, resolve(name));
      const matches = isAbsolute(rel) || rel === ".." || rel.startsWith("../") ? [] : placed.filter((a) => tidy(a.path) === tidy(rel));
      if (matches.length > 1) {
        throw new FlowError(`--${flag} "${name}" is the path of ${matches.map((a) => a.artifact.artifact).join(" and ")}; name the artifact by its id`);
      }
      id = matches[0]?.artifact.artifact;
    }
    if (id === undefined) {
      throw new FlowError(`--${flag} names an artifact the step ${verb}, by its id or its path; "${name}" is neither (${known})`);
    }
    out[id] = why;
  }
  return out;
}

function finishStep(c: Ctx, step: Step, given: Continue): string[] {
  const input: Continue = {
    ...given,
    unchanged: byArtifactId(c, "unchanged", "updates", step.updates, given.unchanged),
    notProduced: byArtifactId(c, "not-produced", "produces", step.produces, given.notProduced),
  };
  const updated = [...new Set(input.updated.map((f) => display(c.p, f)))];

  const produced = place(c, step.produces);
  const missing = produced.filter((a) => !onDisk(c, a.path) && !(a.artifact.artifact in input.notProduced));
  if (missing.length) {
    throw refuse(
      c,
      step,
      `missing artifact(s): ${missing.map((a) => `${a.path} (${a.artifact.artifact})`).join(", ")}. Write each, or report one ` +
        `the step rightly does not produce with --not-produced <artifact> "<reason>".`,
    );
  }
  const unaccounted = place(c, step.updates).filter(
    (a) => !(a.artifact.artifact in input.unchanged) && !updated.some((f) => contains(a.path, f)),
  );
  if (unaccounted.length) {
    throw refuse(
      c,
      step,
      `not accounted for: ${unaccounted.map((a) => `${a.artifact.artifact} (${a.path})`).join(", ")}. Report each file you ` +
        `revised with --updated <file>, or an artifact you left as it was with --unchanged <artifact> "<reason>".`,
    );
  }

  // The checks run without holding the state file's lock, so a long test run
  // does not stall fuse-flow commands for other workstreams. A refusal records
  // every result so far, and the gates not run, for the hand-over block.
  const verification: string[] = [];
  const mechanicalGates = gatesInOrder(step).filter((g) => g.kind === "check" || g.kind === "script");
  const failWith = (i: number, result: string, reason: string, output = "") => {
    verification.push(result, ...mechanicalGates.slice(i + 1).map((g) => `${mechanical(c, g).label}: not run`));
    return refuse(c, step, reason, output, verification);
  };
  for (const [i, g] of mechanicalGates.entries()) {
    const m = mechanical(c, g);
    if (m.kind === "unbound") throw failWith(i, `${m.label}: not run, no command is bound`, bindInstruction(c, m.check));
    if (m.kind === "none") {
      verification.push(`${m.label}: not configured in this project`);
      continue;
    }
    const r = runCommand(c, m.command, step.id);
    if (r.exitCode !== 0) {
      const failed = `${m.label} failed (exit ${r.exitCode ?? "none, killed by a signal"})`;
      throw failWith(i, `${m.label}: failed (exit ${r.exitCode ?? "none"})`, failed, r.output);
    }
    verification.push(`${m.label}: passed`);
  }

  const awaitsOwner = ownerGates(step).length > 0;
  updateWorkstream(c.root, c.slug, (ws) => {
    const state = expectState(c, ws, step, ["IN_PROGRESS"]);
    const status = awaitsOwner ? "draft" : "approved";
    state.artifacts = [
      ...[...produced, ...place(c, step.optional_produces)]
        .filter((a) => !(a.artifact.artifact in input.notProduced) && onDisk(c, a.path))
        .map((a) => ({ artifact: a.artifact.artifact, path: a.path, status })),
      ...place(c, step.updates)
        .filter((a) => onDisk(c, a.path))
        .map((a) => ({ artifact: a.artifact.artifact, path: a.path, status })),
    ] as StepState["artifacts"];
    setOrDelete(state, "updated", updated.length ? updated : undefined);
    setOrDelete(state, "unchanged", Object.keys(input.unchanged).length ? input.unchanged : undefined);
    setOrDelete(state, "not_produced", Object.keys(input.notProduced).length ? input.notProduced : undefined);
    setOrDelete(state, "verification", verification.length ? verification : undefined);
    state.status = awaitsOwner ? "AWAITING_OWNER" : "COMPLETED";
    state.history.push(stamp(awaitsOwner ? EVENT.awaitingOwner() : EVENT.completed()));
  });
  return [`${step.id}: ${awaitsOwner ? "work recorded; the step awaits the owner's action" : "COMPLETED"}`, "", ...present(c)];
}

function setOrDelete<K extends keyof StepState>(state: StepState, key: K, value: StepState[K] | undefined): void {
  if (value === undefined) delete state[key];
  else state[key] = value;
}

function blockStep(c: Ctx, step: Step, reason: string): string[] {
  updateWorkstream(c.root, c.slug, (ws) => {
    const state = expectState(c, ws, step, ["IN_PROGRESS"]);
    state.status = "BLOCKED";
    state.history.push(stamp(EVENT.blocked(reason)));
  });
  return [`${step.id}: BLOCKED: ${reason}`, "", ...present(c)];
}

function skipStep(c: Ctx, step: Step, reason: string): string[] {
  updateWorkstream(c.root, c.slug, (ws) => {
    const state = expectState(c, ws, step, ["PENDING", "IN_PROGRESS", "AWAITING_OWNER", "BLOCKED"]);
    state.status = "SKIPPED";
    state.skip_reason = reason;
    // An owner-action condition is the owner's answer, so its skip is the
    // owner's, like a skip of a step without a condition.
    const ownersCall = !step.condition || step.condition.kind === "owner-action";
    state.history.push(stamp(ownersCall ? EVENT.skippedOnRequest(reason) : EVENT.skipped(reason)));
  });
  return [`${step.id}: SKIPPED: ${reason}`, "", ...present(c)];
}

// The owner raises the round cap of the step's agent gates by `n`, on a
// blocked step, which is handed back to the agent, or ahead of time on a step
// in progress (decision 45).
function grantRounds(c: Ctx, step: Step, n: number, note?: string): string[] {
  if (!step.gates.some((g) => g.kind === "agent")) {
    throw new FlowError(`step "${step.id}" has no agent gate, so there are no review rounds to grant`);
  }
  updateWorkstream(c.root, c.slug, (ws) => {
    const state = expectState(c, ws, step, ["IN_PROGRESS", "BLOCKED"]);
    state.status = "IN_PROGRESS";
    state.rounds_granted = (state.rounds_granted ?? 0) + n;
    state.history.push(stamp(EVENT.roundsGranted(n, note)));
  });
  return [`${step.id}: owner granted ${n} more review round${n === 1 ? "" : "s"}; the step is IN_PROGRESS`, "", ...present(c)];
}

// Reopen `step` and everything after it: PENDING, its artifacts draft again.
// The files the steps wrote stay where they are.
function reopen(state: StepState, line: string): void {
  state.status = "PENDING";
  for (const a of state.artifacts) if (a.status === "approved") a.status = "draft";
  for (const key of ["rounds_granted", "updated", "unchanged", "not_produced", "verification", "skip_reason", "existed"] as const) {
    delete state[key];
  }
  state.history.push(line);
}

// The owner sends the work back from a step that awaits the owner or is
// blocked to `target`, the step itself or an earlier one.
function sendBack(c: Ctx, step: Step, target: string, note?: string): string[] {
  const from = c.wf.steps.findIndex((s) => s.id === target);
  const at = c.wf.steps.indexOf(step);
  if (from < 0) throw new FlowError(`no step "${target}" in workflow ${c.wf.name}`);
  if (from > at) throw new FlowError(`step "${target}" comes after "${step.id}"; --back-to names "${step.id}" or a step before it`);
  const reopened: string[] = [];
  updateWorkstream(c.root, c.slug, (ws) => {
    const status = stateOf(ws, step.id).status;
    if (status !== "BLOCKED" && status !== "AWAITING_OWNER") {
      throw new FlowError(`step "${step.id}" is ${status}; --back-to answers a step that awaits the owner or is blocked`);
    }
    // One line for the whole send-back, written to every reopened step, so
    // the steps carry the same time and a reader counts it once.
    const line = stamp(EVENT.sentBack(step.id, target, note));
    for (const s of c.wf.steps.slice(from)) {
      const state = stateOf(ws, s.id);
      if (state.status === "PENDING") continue;
      reopened.push(...state.artifacts.map((a) => a.path));
      reopen(state, line);
    }
  });
  return [
    `${step.id}: owner sent the work back to ${target}`,
    ...(reopened.length ? [`If any of ${reopened.join(", ")} keeps a status of its own, as its guide says, set it back to draft.`] : []),
    "",
    ...present(c),
  ];
}

// The owner jumps forward: the current step and every step before `target`
// are SKIPPED with the owner's note (decision 33).
function forwardTo(c: Ctx, step: Step, target: string, note?: string): string[] {
  const to = c.wf.steps.findIndex((s) => s.id === target);
  const at = c.wf.steps.indexOf(step);
  if (to < 0) throw new FlowError(`no step "${target}" in workflow ${c.wf.name}`);
  if (to <= at) throw new FlowError(`step "${target}" is not after "${step.id}"; --forward-to names a later step (use --back-to to go back)`);
  const reason = SKIP_REASON.jumpedForward(target, note);
  updateWorkstream(c.root, c.slug, (ws) => {
    expectState(c, ws, step, ["PENDING", "IN_PROGRESS", "AWAITING_OWNER", "BLOCKED"]);
    for (const s of c.wf.steps.slice(at, to)) {
      const state = stateOf(ws, s.id);
      if (finished(state.status)) continue;
      state.status = "SKIPPED";
      state.skip_reason = reason;
      state.history.push(stamp(EVENT.skipped(reason)));
    }
  });
  return [`jumped forward from ${step.id} to ${target}`, "", ...present(c)];
}

function approveStep(c: Ctx, step: Step, note?: string): string[] {
  let paths: string[] = [];
  updateWorkstream(c.root, c.slug, (ws) => {
    const state = stateOf(ws, step.id);
    if (state.status !== "AWAITING_OWNER" && state.status !== "BLOCKED") {
      throw new FlowError(`step "${step.id}" is ${state.status}, not awaiting the owner or blocked; finish it and run continue without --owner-approved`);
    }
    state.status = "COMPLETED";
    for (const a of state.artifacts) a.status = "approved";
    paths = state.artifacts.map((a) => a.path);
    state.history.push(stamp(EVENT.approved(note)));
  });
  return [
    `${step.id}: owner approved; COMPLETED`,
    ...(paths.length ? [`If any of ${paths.join(", ")} keeps a status of its own, as its guide says, set it to approved.`] : []),
    "",
    ...present(c),
  ];
}

// -------------------------------------------------------------------- status

export function status(root: string, slug: string): string[] {
  const ws = readWorkstream(root, slug);
  const c = context(root, slug, ws);
  const width = Math.max(...c.wf.steps.map((s) => s.id.length));
  const current = currentStep(c.wf, ws);
  const rows = c.wf.steps.map((step) => {
    const state = stateOf(ws, step.id);
    const details = [state.artifacts.map((a) => `${a.path} (${a.status})`).join(", "), state.skip_reason ?? ""].filter(Boolean);
    const marker = step === current ? "> " : "  ";
    const columns = [step.id.padEnd(width), state.status.padEnd(14), `gates ${describeGates(step.gates).padEnd(6)}`];
    return `${marker}${[...columns, details.join("; ")].join("  ")}`.trimEnd();
  });
  const footer = current ? `current step: ${current.id}; ${FUSE_FLOW} start ${slug} prints what to do` : "workflow complete";
  return [`workstream ${slug} (${c.wf.name})`, ...rows, footer];
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
