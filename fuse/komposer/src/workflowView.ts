// SPDX-License-Identifier: Apache-2.0
// Shared types for the app: a workflow as the API returns it, parsed into the
// engine's shape (or kept as raw YAML plus issues when it does not parse),
// and the per-step derived view the diagram and inspector read from.

import YAML from "yaml";
import type { Gate } from "../../flow/src/schemas/gate.ts";
import type { Workflow } from "../../flow/src/schemas/workflow.ts";
import { parseWorkflowText, type WorkflowIssue } from "../../flow/src/parse.ts";

export type LocationId = "project" | "personal" | "fuse-flow";

export interface SessionLocation {
  id: LocationId;
  label: string;
  path: string;
}

export interface Session {
  root: string;
  locations: SessionLocation[];
}

// One workflow file as the server lists it.
export interface WorkflowFile {
  location: LocationId;
  dir: string;
  file: string;
  path: string;
  onDisk: boolean;
  text: string;
  hash: string;
  workingCopy?: string;
}

export const workflowKey = (workflow: Pick<WorkflowFile, "path">): string => workflow.path;

// A workflow file with its text parsed, kept alongside the raw file info so
// the list and header can show it even when parsing failed.
export interface OpenWorkflow extends WorkflowFile {
  // Stable UI-only identity. These values are never serialized.
  stepKeys: string[];
  savedSteps: { key: string; id: string }[];
  // The text actually open: the working copy's when present, else the file's.
  openText: string;
  parsed: Workflow | null;
  issues: WorkflowIssue[];
  // Best-effort structure for display when `parsed` is null: parsed as plain
  // YAML, so the list and header can still show something.
  rawWorkflow: RawWorkflowGuess;
}

// What we can show when the file fails schema validation: raw YAML read
// loosely, so steps still render as cards (missing fields default empty).
export interface RawWorkflowGuess {
  name: string;
  description?: string;
  steps: RawStepGuess[];
}

export interface RawStepGuess {
  id: string;
  title?: string;
  phase?: string;
  description?: string;
  instruction?: string;
  condition?: unknown;
  consumes: string[];
  produces: RawArtifactGuess[];
  optional_produces: RawArtifactGuess[];
  updates: RawArtifactGuess[];
  gates: unknown[];
}

export interface RawArtifactGuess {
  artifact: string;
  path?: string;
  description?: string;
}

function asArtifactArray(v: unknown): RawArtifactGuess[] {
  const items = v === undefined ? [] : Array.isArray(v) ? v : [v];
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      artifact: typeof x.artifact === "string" ? x.artifact : "",
      path: typeof x.path === "string" ? x.path : undefined,
      description: typeof x.description === "string" ? x.description : undefined,
    }));
}

export function guessRawWorkflow(text: string): RawWorkflowGuess {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch {
    doc = null;
  }
  const w = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  const steps = Array.isArray(w.steps) ? w.steps : [];
  return {
    name: typeof w.name === "string" ? w.name : "",
    description: typeof w.description === "string" ? w.description : undefined,
    steps: steps
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        id: typeof s.id === "string" ? s.id : "",
        title: typeof s.title === "string" ? s.title : undefined,
        phase: typeof s.phase === "string" ? s.phase : undefined,
        description: typeof s.description === "string" ? s.description : undefined,
        instruction: typeof s.instruction === "string" ? s.instruction : undefined,
        condition: s.condition,
        consumes: Array.isArray(s.consumes) ? s.consumes.filter((x): x is string => typeof x === "string") : [],
        produces: asArtifactArray(s.produces),
        optional_produces: asArtifactArray(s.optional_produces),
        updates: asArtifactArray(s.updates),
        gates: s.gates === undefined ? [] : Array.isArray(s.gates) ? s.gates : [s.gates],
      })),
  };
}

let nextStepKey = 1;
export const newStepKey = () => `step-${nextStepKey++}`;

function lcsStepMatches(saved: string[], current: string[]): Map<number, number> {
  const lengths = Array.from({ length: saved.length + 1 }, () => new Uint16Array(current.length + 1));
  for (let i = saved.length - 1; i >= 0; i--) {
    for (let j = current.length - 1; j >= 0; j--) {
      lengths[i][j] =
        saved[i] === current[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const matches = new Map<number, number>();
  for (let i = 0, j = 0; i < saved.length && j < current.length; ) {
    if (saved[i] === current[j]) {
      matches.set(j++, i++);
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

export function openWorkflow(file: WorkflowFile | OpenWorkflow, resetIdentity = false): OpenWorkflow {
  const openText = file.workingCopy ?? file.text;
  const parsed = parseWorkflowText(openText);
  const savedIds = guessRawWorkflow(file.text).steps.map((step) => step.id);
  const currentIds = guessRawWorkflow(openText).steps.map((step) => step.id);
  const previous = !resetIdentity && "stepKeys" in file ? (file as OpenWorkflow) : undefined;
  const savedSteps = previous?.savedSteps ?? savedIds.map((id) => ({ key: newStepKey(), id }));
  const matches = lcsStepMatches(
    savedSteps.map((step) => step.id),
    currentIds,
  );
  const stepKeys =
    previous?.stepKeys ??
    currentIds.map((_id, index) => {
      const savedIndex = matches.get(index);
      return savedIndex === undefined ? newStepKey() : savedSteps[savedIndex].key;
    });
  return {
    ...file,
    stepKeys,
    savedSteps,
    openText,
    parsed: parsed.ok ? parsed.workflow : null,
    issues: parsed.ok ? [] : parsed.issues,
    rawWorkflow: guessRawWorkflow(openText),
  };
}

// --------------------------------------------------------------- step view

export type ArtifactRole = "produces" | "optional_produces" | "updates";

export interface ArtifactView {
  role: ArtifactRole;
  artifact: string;
  path: string;
  description?: string;
}

// A step normalized for the diagram and inspector, whether it came from a
// fully parsed workflow or a raw guess.
export interface StepView {
  id: string;
  title?: string;
  phase?: string;
  description?: string;
  instruction?: string;
  condition?: { kind: Gate["kind"]; text: string; description?: string };
  consumes: string[];
  artifacts: ArtifactView[];
  gates: Gate[];
}

export function stepViewsFromWorkflow(w: Workflow): StepView[] {
  return w.steps.map((s) => ({
    id: s.id,
    title: s.title,
    phase: s.phase,
    description: s.description,
    instruction: s.instruction,
    condition: s.condition
      ? { kind: s.condition.kind, text: s.condition.text, description: s.condition.description }
      : undefined,
    consumes: s.consumes,
    artifacts: [
      ...s.produces.map((a) => ({ role: "produces" as const, ...a })),
      ...s.optional_produces.map((a) => ({ role: "optional_produces" as const, ...a })),
      ...s.updates.map((a) => ({ role: "updates" as const, ...a })),
    ],
    gates: s.gates,
  }));
}

function guessGate(raw: unknown): Gate | null {
  if (!raw || typeof raw !== "object") return null;
  const { max_rounds, guide, route_back_to, description, ...rest } = raw as Record<string, unknown>;
  const entries = Object.entries(rest).filter(([k]) => k !== "description");
  if (entries.length !== 1) return null;
  const [kind, text] = entries[0];
  if (!["owner-action", "check", "script", "agent"].includes(kind)) return null;
  const routes =
    route_back_to === undefined
      ? []
      : Array.isArray(route_back_to)
        ? (route_back_to as string[])
        : [route_back_to as string];
  return {
    kind: kind as Gate["kind"],
    text: typeof text === "string" ? text : "",
    route_back_to: routes,
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof max_rounds === "number" ? { max_rounds } : {}),
    ...(typeof guide === "string" ? { guide } : {}),
  };
}

export function stepViewsFromRaw(w: RawWorkflowGuess): StepView[] {
  return w.steps.map((s) => {
    const cond = guessGate(s.condition);
    return {
      id: s.id,
      title: s.title,
      phase: s.phase,
      description: s.description,
      instruction: s.instruction,
      condition: cond ? { kind: cond.kind, text: cond.text, description: cond.description } : undefined,
      consumes: s.consumes,
      artifacts: [
        ...s.produces.map((a) => ({ role: "produces" as const, ...a, path: a.path ?? "" })),
        ...s.optional_produces.map((a) => ({ role: "optional_produces" as const, ...a, path: a.path ?? "" })),
        ...s.updates.map((a) => ({ role: "updates" as const, ...a, path: a.path ?? "" })),
      ],
      gates: s.gates.map(guessGate).filter((g): g is Gate => g !== null),
    };
  });
}

export function stepViews(w: OpenWorkflow): StepView[] {
  return w.parsed ? stepViewsFromWorkflow(w.parsed) : stepViewsFromRaw(w.rawWorkflow);
}

// Gates and conditions run checks and scripts first, then agent, then owner.
const GATE_ORDER: Record<Gate["kind"], number> = { check: 0, script: 0, agent: 1, "owner-action": 2 };

export function gatesInRunOrder(gates: Gate[]): { gate: Gate; fileIndex: number }[] {
  return gates
    .map((gate, fileIndex) => ({ gate, fileIndex }))
    .sort((a, b) => GATE_ORDER[a.gate.kind] - GATE_ORDER[b.gate.kind] || a.fileIndex - b.fileIndex);
}

export const stem = (file: string) => file.replace(/\.ya?ml$/, "");
export const gateCount = (steps: StepView[]) => steps.reduce((n, s) => n + s.gates.length, 0);
export const routeBackCount = (steps: StepView[]) =>
  steps.reduce((n, s) => n + s.gates.reduce((m, g) => m + g.route_back_to.length, 0), 0);
export const artifactCount = (steps: StepView[]) =>
  new Set(steps.flatMap((s) => s.artifacts.map((a) => a.artifact))).size;
