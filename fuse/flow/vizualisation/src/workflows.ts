// SPDX-License-Identifier: Apache-2.0
// Reads every *.yml under ../../workflows (subfolders included) at build time
// and turns each into the shape the diagram draws. Read-only: nothing is written back.

import YAML from "yaml";

export type Gate =
  | { kind: "owner" }
  | { kind: "check"; command: string }
  | { kind: "review"; skill: string; maxRounds?: number };

export type Step = {
  id: string;
  title: string;
  skills: string[];
  produces: string[];
  gates: Gate[];
  // null: depends_on omitted, so the step runs after the one listed before it.
  dependsOn: string[] | null;
  onFail: string | null;
  // Set only when the step overrides the workflow's max_fix_cycles.
  maxFixCycles: number | null;
};

export type Workflow = {
  // Path relative to the workflows dir, e.g. "team/hotfix.yml".
  path: string;
  file: string;
  dir: string;
  description: string;
  maxFixCycles: number | null;
  steps: Step[];
  error: string | null;
  // The file's text as it is on disk.
  source: string;
};

const WORKFLOWS_DIR = "fuse/flow/workflows";

const sources = import.meta.glob("../../workflows/**/*.yml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];

function parseGate(v: unknown): Gate | null {
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "owner") return { kind: "owner" };
    const command = /^check:(.*)$/s.exec(s)?.[1].trim();
    if (command) return { kind: "check", command };
    return null;
  }
  if (v && typeof v === "object" && "review" in v) {
    const r = (v as { review: { skill?: unknown; max_rounds?: unknown } }).review ?? {};
    return {
      kind: "review",
      skill: typeof r.skill === "string" ? r.skill : "",
      maxRounds: typeof r.max_rounds === "number" ? r.max_rounds : undefined,
    };
  }
  return null;
}

function parseStep(raw: Record<string, unknown>, i: number): Step {
  const id = typeof raw.id === "string" ? raw.id : `step-${i + 1}`;
  const gates = [raw.gate, ...(Array.isArray(raw.gates) ? raw.gates : [])]
    .map(parseGate)
    .filter((g): g is Gate => g !== null);
  if (raw.review) {
    const g = parseGate({ review: raw.review });
    if (g) gates.push(g);
  }
  return {
    id,
    // Drop a leading "0. " style number: the card already shows the step number.
    title: typeof raw.title === "string" ? raw.title.replace(/^\d+\.\s+/, "") : id,
    skills: [...asStrings(raw.skill), ...asStrings(raw.skills)],
    produces: asStrings(raw.produces),
    gates,
    dependsOn: Array.isArray(raw.depends_on) ? asStrings(raw.depends_on) : null,
    onFail: typeof raw.on_fail === "string" ? raw.on_fail : null,
    maxFixCycles: typeof raw.max_fix_cycles === "number" ? raw.max_fix_cycles : null,
  };
}

function parseWorkflow(path: string, text: string): Workflow {
  const slash = path.lastIndexOf("/");
  const base: Workflow = {
    path,
    file: path.slice(slash + 1),
    dir: slash < 0 ? "" : path.slice(0, slash),
    description: "",
    maxFixCycles: null,
    steps: [],
    error: null,
    source: text,
  };
  try {
    const doc = YAML.parse(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object") return { ...base, error: "not a YAML mapping" };
    const steps = Array.isArray(doc.steps) ? doc.steps : [];
    return {
      ...base,
      description: typeof doc.description === "string" ? doc.description : "",
      maxFixCycles: typeof doc.max_fix_cycles === "number" ? doc.max_fix_cycles : null,
      steps: steps
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map(parseStep),
      error: Array.isArray(doc.steps) ? null : "no steps list",
    };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

export const workflowsDir = WORKFLOWS_DIR;

export const workflows: Workflow[] = Object.entries(sources)
  .map(([key, text]) => parseWorkflow(key.replace("../../workflows/", ""), text))
  .sort((a, b) => a.dir.localeCompare(b.dir) || a.file.localeCompare(b.file));
