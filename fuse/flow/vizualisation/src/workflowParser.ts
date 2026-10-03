// SPDX-License-Identifier: Apache-2.0
// Pure parser for one fuse-flow workflow. Kept separate from Vite's build-time
// file loading so it can also be checked directly with Bun.

import YAML from "yaml";

export type GateKind = "owner-action" | "check" | "script" | "agent";

export type Gate = {
  kind: GateKind;
  description: string;
  maxRounds?: number;
  guide?: string;
  routeBackTo: string[];
};

export type ArtifactRole = "produces" | "optional-produces" | "updates";

export type Artifact = {
  id: string;
  path: string;
  role: ArtifactRole;
};

export type Step = {
  id: string;
  title: string;
  phase: string | null;
  condition: Gate | null;
  consumes: string[];
  artifacts: Artifact[];
  gates: Gate[];
  // The steps this step's gates route back to, from their route_back_to.
  routesBackTo: string[];
};

export type Workflow = {
  // Path relative to the workflows dir, e.g. "team/hotfix.yml".
  path: string;
  file: string;
  dir: string;
  description: string;
  steps: Step[];
  error: string | null;
  // The file's text as it is on disk.
  source: string;
};

const GATE_KINDS = ["owner-action", "check", "script", "agent"] as const;
const isGateKind = (kind: string): kind is GateKind => (GATE_KINDS as readonly string[]).includes(kind);
const asList = (value: unknown): unknown[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function parseGate(value: unknown, location: string, condition = false): { gate: Gate | null; error?: string } {
  let kind: string;
  let description: unknown;
  let extras: Record<string, unknown> = {};

  if (typeof value === "string" && !condition) {
    const text = value.trim();
    if (text === "owner" || text === "none") {
      return { gate: null, error: `${location}: legacy gate ${JSON.stringify(text)} is not supported` };
    }
    const match = /^([a-z-]+)\s*(?:\(\s*"?(.*?)"?\s*\)|:(.*))$/s.exec(text);
    if (!match) return { gate: null, error: `${location}: invalid gate` };
    kind = match[1];
    description = match[2] ?? match[3];
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const { max_rounds, guide, description: _note, route_back_to, ...mapping } = value as Record<string, unknown>;
    const entries = Object.entries(mapping);
    if (entries.length !== 1) return { gate: null, error: `${location}: gate must have one kind` };
    [kind, description] = entries[0];
    extras = { max_rounds, guide, route_back_to };
  } else {
    return { gate: null, error: `${location}: invalid gate` };
  }

  if (!isGateKind(kind)) return { gate: null, error: `${location}: unknown gate kind ${JSON.stringify(kind)}` };
  if (typeof description !== "string" || !description.trim()) {
    return { gate: null, error: `${location}: ${kind} gate needs text` };
  }
  if (kind === "check" && !/^[a-z][a-z0-9]*$/.test(description.trim())) {
    return { gate: null, error: `${location}: check must name a check kind` };
  }
  if (condition && Object.values(extras).some((extra) => extra !== undefined)) {
    return { gate: null, error: `${location}: condition cannot set gate options` };
  }

  const routes = extras.route_back_to === undefined ? [] : asList(extras.route_back_to);
  if (!routes.every((route): route is string => typeof route === "string")) {
    return { gate: null, error: `${location}: route_back_to must name step ids` };
  }
  if (extras.max_rounds !== undefined && kind !== "agent") {
    return { gate: null, error: `${location}: max_rounds is only valid on agent gates` };
  }
  if (
    extras.max_rounds !== undefined &&
    (!Number.isInteger(extras.max_rounds) || (extras.max_rounds as number) < 1)
  ) {
    return { gate: null, error: `${location}: max_rounds must be a positive whole number` };
  }
  if (extras.guide !== undefined && (kind !== "agent" || typeof extras.guide !== "string" || !extras.guide.trim())) {
    return { gate: null, error: `${location}: guide must be a path on an agent gate` };
  }

  const gate: Gate = { kind, description: description.trim(), routeBackTo: routes };
  if (extras.max_rounds !== undefined) gate.maxRounds = extras.max_rounds as number;
  if (extras.guide !== undefined) gate.guide = (extras.guide as string).trim();
  return { gate };
}

function parseArtifacts(value: unknown, role: ArtifactRole, location: string): { artifacts: Artifact[]; errors: string[] } {
  const artifacts: Artifact[] = [];
  const errors: string[] = [];
  asList(value).forEach((item, index) => {
    const itemLocation = `${location}${Array.isArray(value) ? `[${index}]` : ""}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${itemLocation}: artifact must be a mapping`);
      return;
    }
    const { artifact, path } = item as Record<string, unknown>;
    if (typeof artifact !== "string" || !artifact) errors.push(`${itemLocation}: artifact id is required`);
    if (typeof path !== "string" || !path) errors.push(`${itemLocation}: artifact path is required`);
    if (typeof artifact === "string" && artifact && typeof path === "string" && path) {
      artifacts.push({ id: artifact, path, role });
    }
  });
  return { artifacts, errors };
}

function parseStep(raw: Record<string, unknown>, index: number): { step: Step; errors: string[] } {
  const location = `steps[${index}]`;
  const errors: string[] = [];
  const id = typeof raw.id === "string" ? raw.id : `step-${index + 1}`;
  if (typeof raw.id !== "string") errors.push(`${location}.id: step id is required`);
  for (const legacy of ["skill", "skills", "depends_on", "gate", "review"] as const) {
    if (raw[legacy] !== undefined) errors.push(`${location}.${legacy}: legacy field is not supported`);
  }

  const gates = asList(raw.gates)
    .map((value, gateIndex) => parseGate(value, `${location}.gates[${gateIndex}]`))
    .flatMap((result) => {
      if (result.error) errors.push(result.error);
      return result.gate ? [result.gate] : [];
    });

  const parsedCondition = raw.condition === undefined ? { gate: null } : parseGate(raw.condition, `${location}.condition`, true);
  if (parsedCondition.error) errors.push(parsedCondition.error);

  const consumes = raw.consumes === undefined ? [] : raw.consumes;
  if (!Array.isArray(consumes) || !consumes.every((item): item is string => typeof item === "string")) {
    errors.push(`${location}.consumes: consumes must be a list of artifact ids`);
  }

  const artifactGroups = [
    parseArtifacts(raw.produces, "produces", `${location}.produces`),
    parseArtifacts(raw.optional_produces, "optional-produces", `${location}.optional_produces`),
    parseArtifacts(raw.updates, "updates", `${location}.updates`),
  ];
  errors.push(...artifactGroups.flatMap((group) => group.errors));

  return {
    step: {
      id,
      // Drop a leading "0. " style number: the card already shows the step number.
      title: typeof raw.title === "string" ? raw.title.replace(/^\d+\.\s+/, "") : id,
      phase: typeof raw.phase === "string" ? raw.phase : null,
      condition: parsedCondition.gate,
      consumes: Array.isArray(consumes) ? consumes.filter((item): item is string => typeof item === "string") : [],
      artifacts: artifactGroups.flatMap((group) => group.artifacts),
      gates,
      routesBackTo: [...new Set(gates.flatMap((gate) => gate.routeBackTo))],
    },
    errors,
  };
}

export function parseWorkflow(path: string, text: string): Workflow {
  const slash = path.lastIndexOf("/");
  const base: Workflow = {
    path,
    file: path.slice(slash + 1),
    dir: slash < 0 ? "" : path.slice(0, slash),
    description: "",
    steps: [],
    error: null,
    source: text,
  };
  try {
    const doc = YAML.parse(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ...base, error: "not a YAML mapping" };
    if (!Array.isArray(doc.steps)) return { ...base, error: "no steps list" };

    const errors: string[] = [];
    const steps = doc.steps.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`steps[${index}]: step must be a mapping`);
        return [];
      }
      const parsed = parseStep(raw as Record<string, unknown>, index);
      errors.push(...parsed.errors);
      return [parsed.step];
    });
    return {
      ...base,
      description: typeof doc.description === "string" ? doc.description : "",
      steps,
      error: errors.length > 0 ? errors.join("\n") : null,
    };
  } catch (error) {
    return { ...base, error: (error as Error).message };
  }
}

